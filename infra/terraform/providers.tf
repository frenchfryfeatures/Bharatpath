# BharatPath development infrastructure.
#
# Scope is deliberately narrow. This provisions only what cannot be run
# locally -- Cognito above all, which has no emulator (LocalStack's free
# tier does not provide it, and app/core/auth/cognito.py is written
# against the real thing).
#
# Postgres and Redis are NOT here. They run in docker-compose for local
# work and as service containers in CI, which is free and faster than a
# round trip to Mumbai. RDS, ElastiCache, VPC/NAT and ECS arrive at
# deployment (plan.md Day 20), not during the sprint -- those are the
# resources that bill while idle.
#
# Everything below is either free-tier or fractions of a rupee at dev
# volume, so there is nothing to shut down between sessions.
# `terraform destroy` removes all of it if needed.

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  # The label people read; `var.environment` is the immutable name suffix.
  stage = var.stage != "" ? var.stage : var.environment
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "bharatpath"
      Environment = local.stage
      ManagedBy   = "terraform"
    }
  }
}
