# One image, two deployables. `uvicorn app.main:app` and
# `celery -A app.worker worker` run from this same image, so the API and the
# workers can never drift on model definitions.

FROM python:3.12-slim AS base
# PYTHONPATH: `pip install .` runs before `app/` is copied, so the package is
# importable only from the working directory -- which `uvicorn` and
# `python -m alembic` add to sys.path and `python scripts/x.py` does not
# (it adds `scripts/`). Without this, `seed_config.py` and
# `create_platform_staff.py` die with "No module named 'app'" (2026-10-01).
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/srv

WORKDIR /srv

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq5 curl \
 && rm -rf /var/lib/apt/lists/*

# Amazon's RDS CA bundle. RDS forces TLS and its certificates chain to this,
# not to anything in the system store, so `connect_args_for` verifies
# against it. Unused by any other database host.
RUN mkdir -p /srv/certs \
 && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      -o /srv/certs/rds-global-bundle.pem
ENV DATABASE_SSL_ROOT_CERT=/srv/certs/rds-global-bundle.pem

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY scripts ./scripts
COPY data ./data

# Never run as root.
RUN useradd --create-home --uid 10001 bharatpath
USER bharatpath

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
