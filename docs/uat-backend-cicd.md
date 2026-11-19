# AWS UAT backend CI/CD

Backend and deployment changes merged/pushed into `uat` run backend CI, then
deploy only after invariants, lint/types, tests and the image build pass.
Pull requests and production pushes never deploy through this job. Deployment
uses the tested push SHA, includes taxonomy seeds and checks migration exit
status and API health. Active push runs are not cancelled by later pushes.

## One-time operator setup

1. Create GitHub environment `uat` under repository Settings → Environments.
   Restrict its deployment branches to `uat`; add reviewers if required.
2. Register a dedicated Linux x64 self-hosted runner from Settings → Actions →
   Runners → New self-hosted runner, following GitHub's generated commands.
   Add custom label `bharatpath-uat-deploy` and install its service.
   It needs Bash, Git, OpenSSH and tar. Use a separate trusted machine rather
   than the API host; never send PR/untrusted jobs to this runner. Prefer an
   ephemeral runner if your infrastructure supports it.
3. Permit that runner's fixed/private source address to reach port 22 on the
   UAT EC2 security group. Do not open SSH to all addresses. The runner also
   needs HTTPS access to GitHub.
4. Authorize a dedicated unattended UAT SSH key for `ec2-user` on
   `13.235.1.169`. Add its private key as environment secret
   `UAT_SSH_PRIVATE_KEY`. Keep production credentials out of this environment.
   The existing deployment requires write access to `/opt/bharatpath` and
   permission to run Docker commands.
5. Add environment secret `UAT_SSH_KNOWN_HOSTS`, containing the verified SSH
   host-key entry for `13.235.1.169`. Verify its fingerprint through a trusted
   existing SSH connection or AWS Session Manager before saving it. The
   workflow enforces strict host-key checking; a blind `ssh-keyscan` is not
   verification.
6. Verify the UAT host's existing `.env` points to UAT RDS and services. Secrets
   remain on the host. Take an RDS snapshot before the first schema/seed run.

Restrict who can modify/push to `uat` and edit the workflow: the runner executes
trusted repository code with deployment credentials. Set environment branch
protection before enabling the runner.

## Activation and verification

Resolve the existing backend CI failures before expecting deployment. Merge
the workflow PR into `uat`; its push run executes the complete pipeline. If
setup was unfinished, complete setup and rerun the failed workflow in Actions.
The migration service must exit 0 and API/worker/beat must start. Verify both
onboarding dropdown cascades using `docs/uat-taxonomy-deployment.md`.

This deployment restarts services and can cause a short interruption. It does
not automatically downgrade database migrations on failure. Inspect migration
logs and the host state before retrying an interrupted/failed deployment.
Production deployment is intentionally outside this job.

Committing the workflow does not provision a runner, SSH credentials, security
group access or the GitHub environment; the operator steps above activate it.
