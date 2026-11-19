# The test deployment: one EC2 host running the whole stack in docker compose.
#
# Added 2026-09-22. **This is deliberately not production**, and the shape of
# it is a decision rather than a shortcut -- see `docs/aws-deployment.md` for
# the migration to ECS Fargate + ALB + RDS + ElastiCache, which is where this
# goes and which is why several things below are arranged the way they are.
#
# ---------------------------------------------------------------------------
# What this is, and what it is not
# ---------------------------------------------------------------------------
# One instance, in the DEFAULT VPC, with a public IP. API, Celery worker,
# Celery beat, Postgres and Redis all run as containers on it, exactly as
# they do on a developer's laptop. There is no private subnet, no NAT
# gateway, no load balancer and no managed database.
#
# The cost of that choice is honest and worth writing down:
#
#   * **Postgres has no managed backups.** It is a container on an EBS
#     volume. The volume survives an instance replacement (it is separate,
#     below) and nothing else protects it. Do not put data here you would
#     mind losing.
#   * **The database is reachable from the instance only**, which is the one
#     thing this does keep right: 5432 and 6379 are not in the security group.
#   * **No horizontal scale and no zero-downtime deploy.** `docker compose up`
#     restarts the API.
#   * **TLS terminates on the box** (Caddy, see user_data) rather than at an
#     ALB with ACM.
#
# What it does give the app teams is a real, reachable, authenticated API with
# real Cognito, real S3 and real SQS behind it -- which is what unblocks them.
#
# ---------------------------------------------------------------------------
# Everything here is behind `var.deploy_ec2`
# ---------------------------------------------------------------------------
# Default false. The rest of this module is free at idle; an instance is not,
# and the sprint's working assumption -- that nothing bills between sessions --
# stops being true the moment this is switched on. Turning it on must be a
# deliberate act, and turning it off again is `-var deploy_ec2=false`.

locals {
  deploy = var.deploy_ec2 ? 1 : 0
}

# Network: the default VPC, looked up in network.tf.

# Amazon Linux 2023, x86_64. **Not ARM**, deliberately: `backend/Dockerfile`
# is built by whatever machine runs it, and an image built on an x86 laptop or
# x86 CI runner will not start on Graviton. ARM is cheaper and is the right
# choice once images are built in CI for a pinned architecture.
data "aws_ami" "al2023" {
  count       = local.deploy
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-6.1-x86_64"]
  }
}

# ---------------------------------------------------------------------------
# Network access
# ---------------------------------------------------------------------------
resource "aws_security_group" "app" {
  count       = local.deploy
  name        = "${var.project}-app-${var.environment}"
  description = "BharatPath test host: HTTP/HTTPS from anywhere, SSH from the admin CIDR."
  vpc_id      = data.aws_vpc.default.id

  # **Postgres (5432) and Redis (6379) are absent and must stay absent.**
  # They are containers on this host reached over the compose network. A rule
  # for either one exposes an unmanaged database with a development password
  # to the internet.

  ingress {
    description = "HTTP. Caddy redirects to HTTPS and answers the ACME challenge on this port."
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS. The API, for the four client teams."
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Narrow this. `0.0.0.0/0` is the default only because an empty default
  # locks the first person out of the box they just made; it is the one rule
  # here worth changing before the instance runs for more than a day.
  ingress {
    description = "SSH, for deploys and logs."
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_allowed_cidrs
  }

  egress {
    description = "Outbound: S3, SQS, Cognito, SES, OpenAI, Sarvam, package registries."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------
# Identity: an instance role, NOT the IAM user's access key
# ---------------------------------------------------------------------------
# The same policy the app user has, attached to a role the instance assumes.
# boto3 finds it through the instance metadata service with no configuration,
# so `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are simply absent from
# the host's environment file.
#
# That is the point. A long-lived secret key in an env file on a public box is
# the credential most likely to leak and the hardest to notice leaking;
# instance-role credentials are rotated by AWS and never written down. The IAM
# user stays for local development, where there is no instance to assume a
# role.
#
# It also survives the move to ECS unchanged: a task role is the same idea
# with a different principal, so this is one of the pieces that does not have
# to be rebuilt later.
resource "aws_iam_role" "instance" {
  count = local.deploy
  name  = "${var.project}-instance-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "instance" {
  count = local.deploy
  name  = "${var.project}-instance-${var.environment}"
  role  = aws_iam_role.instance[0].id
  # The identical document the IAM user gets. One policy, two principals --
  # so a permission added for local development is not silently missing in
  # the deployment, which is the drift this avoids.
  policy = data.aws_iam_policy_document.app.json
}

# Lets you open a shell through the console with no SSH key and no open port.
# The recovery path when SSH is locked down or a key is lost.
resource "aws_iam_role_policy_attachment" "ssm" {
  count      = local.deploy
  role       = aws_iam_role.instance[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "instance" {
  count = local.deploy
  name  = "${var.project}-instance-${var.environment}"
  role  = aws_iam_role.instance[0].name
}

# ---------------------------------------------------------------------------
# The host
# ---------------------------------------------------------------------------
resource "aws_key_pair" "admin" {
  count      = var.deploy_ec2 && var.ssh_public_key != "" ? 1 : 0
  key_name   = "${var.project}-admin-${var.environment}"
  public_key = var.ssh_public_key
}

resource "aws_instance" "app" {
  count = local.deploy

  ami                    = data.aws_ami.al2023[0].id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.primary.id
  vpc_security_group_ids = [aws_security_group.app[0].id]
  iam_instance_profile   = aws_iam_instance_profile.instance[0].name
  key_name               = var.ssh_public_key != "" ? aws_key_pair.admin[0].key_name : null

  # IMDSv2 required. The older version can be read by anything that can make
  # the server fetch a URL, which turns an SSRF bug into the instance role's
  # credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2 # containers are one hop further out
  }

  # `standard`, not the t3 default of `unlimited`. Unlimited bills for every
  # minute spent above the baseline once banked credits are gone, so a
  # runaway worker becomes a line on the invoice; standard throttles it to
  # the baseline instead. On a credit budget, slow is the better failure.
  credit_specification {
    cpu_credits = "standard"
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  user_data                   = file("${path.module}/user_data.sh")
  user_data_replace_on_change = false # changing it must not destroy the box

  tags = {
    Name = "${var.project}-app-${local.stage}"
  }

  lifecycle {
    # The AMI moves every few weeks and Terraform would otherwise offer to
    # replace a running host to pick it up. Replace it deliberately.
    #
    # user_data runs on first boot only, so an edit does nothing to a running
    # host -- except that applying it makes AWS stop and start the instance,
    # which is downtime for no effect. Make the same change on the live host
    # by hand; a rebuilt host picks up the file (2026-10-01).
    ignore_changes = [ami, user_data]
  }
}

# Postgres's data directory, on its own volume so that replacing the instance
# -- to resize it, or to take a new AMI -- does not destroy the database.
# This is the nearest thing this deployment has to durability, and it is not
# a backup: see `docs/aws-deployment.md`.
resource "aws_ebs_volume" "data" {
  count             = local.deploy
  availability_zone = aws_instance.app[0].availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${var.project}-data-${local.stage}"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  count       = local.deploy
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data[0].id
  instance_id = aws_instance.app[0].id
}

# A stable address. Without it the public IP changes on every stop/start, and
# four client teams have the old one in their configuration.
resource "aws_eip" "app" {
  count    = local.deploy
  instance = aws_instance.app[0].id
  domain   = "vpc"

  tags = {
    Name = "${var.project}-app-${local.stage}"
  }
}
