"""Store per-installation push tokens and delivery outcomes."""

from alembic import op

revision = "0014_push_devices"
down_revision = "0013_employer_profile"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS push_devices (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(256) NOT NULL UNIQUE,
            platform VARCHAR(8) NOT NULL CHECK (platform IN ('android', 'ios')),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_push_devices_user_id ON push_devices(user_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS push_deliveries (
            notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
            device_id UUID NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
            state VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'SENT', 'FAILED')),
            attempts INTEGER NOT NULL DEFAULT 0,
            ticket_id VARCHAR(128),
            failure_code VARCHAR(64),
            attempted_at TIMESTAMPTZ,
            receipt_checked_at TIMESTAMPTZ,
            PRIMARY KEY (notification_id, device_id)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_push_deliveries_pending ON push_deliveries(attempted_at) WHERE state = 'PENDING'"
    )
    # Existing databases already have erase_candidate; insert the new erasure
    # statements into its live definition. Fresh databases get the same lines
    # from the baseline migration.
    op.execute("""
        DO $body$
        DECLARE definition text;
        DECLARE old_line text := 'DELETE FROM notifications WHERE user_id = p_user_id;';
        BEGIN
          SELECT pg_get_functiondef('erase_candidate(uuid, text)'::regprocedure) INTO definition;
          IF position('DELETE FROM push_devices WHERE user_id = p_user_id;' IN definition) = 0 THEN
            definition := replace(definition, old_line,
              'DELETE FROM push_deliveries WHERE notification_id IN
                 (SELECT id FROM notifications WHERE user_id = p_user_id);
               GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object(''push_deliveries'', n);
               DELETE FROM push_devices WHERE user_id = p_user_id;
               GET DIAGNOSTICS n = ROW_COUNT; m := m || jsonb_build_object(''push_devices'', n);
               ' || old_line);
            EXECUTE definition;
          END IF;
        END $body$;
    """)


def downgrade():
    op.drop_table("push_deliveries")
    op.drop_table("push_devices")
