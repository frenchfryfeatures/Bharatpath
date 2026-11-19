# Deploy onboarding dropdown data to UAT

Job and education choices live in each environment's PostgreSQL database.
Deploying code alone does not copy the locally seeded rows. The deployment
now ships `backend/data`, copies it into the image and runs both additive
taxonomy seeders after schema migration. The seeders also backfill historical
profile labels and advance the list-cache revision when options are inserted.

## Deploy the reviewed change

Merge the deployment PR into `uat`, then use a clean checkout of that branch.
Do not run the shipping script from an unrelated working tree: it ships
uncommitted files as well as committed code.

From Git Bash on Windows, with the actual deployment SSH key:

```bash
git switch uat
git pull --ff-only origin uat
BP_SSH_KEY=~/.ssh/id_ed25519 bash deploy/ship.sh 13.235.1.169
```

Before the first deployment, take a manual snapshot of the UAT RDS database
and confirm `/opt/bharatpath/.env` uses UAT's database for
`DATABASE_URL_MIGRATOR`. Do not print the full connection string; it contains
credentials. The deployment uses the existing host configuration and does not
require Terraform or reinitialising RDS.

## Verify on the UAT host

```bash
ssh -i ~/.ssh/id_ed25519 ec2-user@13.235.1.169
cd /opt/bharatpath
docker compose -f docker-compose.prod.yml logs --tail=150 migrate
docker compose -f docker-compose.prod.yml ps -a
```

The migration service must exit with code 0, and API/worker/beat must start.
The baseline job source contains 31 industries, 29 departments, 110 categories
and 507 job roles. The education source contains 9 qualifications, 123 courses,
414 unique specializations and 1,099 course-specialization links. Admin-added
options can make database totals higher. A seed reporting zero insertions on
a subsequent deployment is normal.

If the migration service was not rerun, explicitly run the current image:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps migrate \
  sh -c 'python -m alembic upgrade head && python scripts/seed_job_taxonomy.py --allow-remote && python scripts/seed_education_taxonomy.py --allow-remote'
```

Do not run seeds against an unidentified database. `--allow-remote` permits
the configured RDS connection; it does not select UAT by itself.

## Verify the application

```bash
curl -fsS https://bharatpath-uat.duckdns.org/api/v1/health
curl -fsS https://bharatpath-uat.duckdns.org/api/v1/taxonomy/industries
curl -fsS https://bharatpath-uat.duckdns.org/api/v1/education-taxonomy/qualifications
```

Test both dropdown cascades in onboarding. If the APIs return populated lists
but the UI does not, check the deployed web/mobile API base URL and refresh
the client cache. Public API URL changes require a new client build.

## Subsequent changes and production

The bundled source files bootstrap fresh databases and add missing baseline
options. Existing records are preserved; seeding is not a full synchronisation
of later admin renames, visibility, priorities or custom options. Promote those
changes through reviewed imports in the target environment.

After UAT validation, promote this same code change through the production
release process. Production uses its own host/database; a UAT deployment does
not seed production. Keep database storage persistent and retain backups.
If any existing seed fails (including the pricing seed's environment guard),
resolve its configuration rather than bypassing the migration service.
