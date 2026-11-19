"""Moderated job taxonomy; retain profile snapshots through catalogue changes."""

from alembic import op
from sqlalchemy import CheckConstraint, text
from sqlalchemy.schema import AddConstraint

revision = "0023_job_taxonomy"
down_revision = "0022_career_currency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.modules.taxonomy.models import (
        Department,
        Industry,
        IndustryDepartmentPriority,
        JobRole,
        OtherSubmission,
        RoleCategory,
        TaxonomyRevision,
    )

    bind = op.get_bind()
    for model in (
        Industry,
        Department,
        RoleCategory,
        JobRole,
        IndustryDepartmentPriority,
        OtherSubmission,
        TaxonomyRevision,
    ):
        model.__table__.create(bind, checkfirst=True)
        for constraint in model.__table__.constraints:
            if isinstance(constraint, CheckConstraint) and not bind.scalar(
                text(
                    "SELECT 1 FROM pg_constraint WHERE conname=:name AND conrelid=to_regclass(:table)"
                ),
                {"name": constraint.name, "table": model.__tablename__},
            ):
                bind.execute(AddConstraint(constraint))
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON {model.__tablename__} TO bharatpath_app"
        )
        op.execute(f"GRANT SELECT ON {model.__tablename__} TO bharatpath_admin")
    op.execute("INSERT INTO taxonomy_revision(id,revision) VALUES(1,0) ON CONFLICT DO NOTHING")
    # The function deliberately returns only counts, never candidate data.
    op.execute("""
    CREATE OR REPLACE FUNCTION taxonomy_usage(p_level text, p_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT count(*) FROM candidate_profiles WHERE career->'details'->>
        (CASE p_level WHEN 'industry' THEN 'industry_id' WHEN 'department' THEN 'department_id'
         WHEN 'category' THEN 'role_category_id' WHEN 'role' THEN 'job_role_id' END) = p_id::text
    $$;
    """)
    op.execute("""
    CREATE OR REPLACE FUNCTION taxonomy_is_admin(p_actor uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
        JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=p_actor AND m.role='PLATFORM_ADMIN'
        AND m.status='ACTIVE' AND u.status='ACTIVE' AND u.pool='BUSINESS'
        AND t.type='PLATFORM' AND t.status='ACTIVE')
    $$;
    """)
    op.execute("""
    CREATE OR REPLACE FUNCTION taxonomy_resolve(p_submission uuid,p_option uuid,p_actor uuid,p_action text)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    DECLARE s other_submissions%ROWTYPE; entry other_submissions%ROWTYPE;
      key text; option_name text; option_parent uuid; d jsonb; profile_id uuid;
      affected integer:=0; chain jsonb; child other_submissions%ROWTYPE;
    BEGIN
      IF p_actor IS DISTINCT FROM NULLIF(current_setting('app.taxonomy_actor',true),'')::uuid
        OR NOT taxonomy_is_admin(p_actor) OR p_action NOT IN ('approve','merge','reject') THEN
        RAISE EXCEPTION 'taxonomy permission denied' USING ERRCODE='42501';
      END IF;
      SELECT * INTO s FROM other_submissions WHERE id=p_submission FOR UPDATE;
      IF NOT FOUND OR s.status <> 'pending' THEN RAISE EXCEPTION 'submission changed' USING ERRCODE='40001'; END IF;
      key:=CASE s.level WHEN 'industry' THEN 'industry' WHEN 'department' THEN 'department'
        WHEN 'category' THEN 'role_category' WHEN 'role' THEN 'job_role' END;
      IF p_action <> 'reject' THEN
        CASE s.level
          WHEN 'industry' THEN SELECT name INTO option_name FROM industries WHERE id=p_option AND is_visible AND deleted_at IS NULL;
          WHEN 'department' THEN SELECT name INTO option_name FROM departments WHERE id=p_option AND is_visible AND deleted_at IS NULL;
          WHEN 'category' THEN SELECT name,department_id INTO option_name,option_parent FROM role_categories WHERE id=p_option AND is_visible AND deleted_at IS NULL;
          WHEN 'role' THEN SELECT name,category_id INTO option_name,option_parent FROM job_roles WHERE id=p_option AND is_visible AND deleted_at IS NULL;
        END CASE;
        IF option_name IS NULL THEN RAISE EXCEPTION 'invalid taxonomy target'; END IF;
      END IF;
      FOR entry IN SELECT * FROM other_submissions WHERE level=s.level AND context_key=s.context_key
        AND normalized_text=s.normalized_text AND status='pending' ORDER BY id FOR UPDATE LOOP
        UPDATE other_submissions SET status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'merge' THEN 'merged' ELSE 'rejected' END,
          resolved_option_id=p_option,resolved_by=p_actor,resolved_at=now(),updated_at=now(),version=version+1 WHERE id=entry.id;
        IF p_action <> 'reject' THEN
          SELECT user_id,career->'details' INTO profile_id,d FROM candidate_profiles WHERE user_id=entry.user_id FOR UPDATE;
          -- Do not overwrite a user's newer choice after their suggestion was submitted.
          IF d->>key=entry.raw_text AND NULLIF(d->>(key||'_id'),'') IS NULL THEN
            d:=d || jsonb_build_object(key,option_name,key||'_id',p_option::text);
            d:=jsonb_set(d,'{taxonomy_others}',coalesce(d->'taxonomy_others','{}')-key);
            IF s.level='category' THEN
              d:=d||jsonb_build_object('department_id',option_parent::text,'department',(SELECT name FROM departments WHERE id=option_parent));
              d:=jsonb_set(d,'{taxonomy_others}',coalesce(d->'taxonomy_others','{}')-'department');
            ELSIF s.level='role' THEN
              d:=d||jsonb_build_object('role_category_id',option_parent::text,'role_category',(SELECT name FROM role_categories WHERE id=option_parent),
                'department_id',(SELECT department_id::text FROM role_categories WHERE id=option_parent),
                'department',(SELECT departments.name FROM departments JOIN role_categories ON department_id=departments.id WHERE role_categories.id=option_parent));
              d:=jsonb_set(d,'{taxonomy_others}',coalesce(d->'taxonomy_others','{}')-'department'-'role_category');
            END IF;
            UPDATE candidate_profiles SET career=jsonb_set(career,'{details}',d),updated_at=now() WHERE user_id=entry.user_id;
            -- Children of an Others answer can subsequently be approved under this new parent.
            FOR child IN SELECT * FROM other_submissions WHERE user_id=entry.user_id AND status='pending'
              AND parent_chain->>(s.level||'_text')=entry.normalized_text FOR UPDATE LOOP
              chain:=(child.parent_chain-(s.level||'_text'))||jsonb_build_object(s.level||'_id',p_option::text);
              UPDATE other_submissions SET parent_chain=chain,
                context_key=encode(sha256(convert_to(chain::text,'UTF8')),'hex'),
                parent_id=CASE WHEN (s.level='department' AND child.level='category') OR (s.level='category' AND child.level='role')
                  THEN p_option ELSE child.parent_id END,updated_at=now(),version=version+1 WHERE id=child.id;
            END LOOP;
          END IF;
        END IF;
        affected:=affected+1;
      END LOOP;
      RETURN affected;
    END $$;
    """)
    for signature in (
        "taxonomy_usage(text,uuid)",
        "taxonomy_is_admin(uuid)",
        "taxonomy_resolve(uuid,uuid,uuid,text)",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {signature} TO bharatpath_app")
    # No unscoped read of user-entered suggestions, including from candidate sessions.
    op.execute("ALTER TABLE other_submissions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE other_submissions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS taxonomy_others_access ON other_submissions")
    op.execute("""CREATE POLICY taxonomy_others_access ON other_submissions
      USING (user_id=current_candidate_id() OR taxonomy_is_admin(NULLIF(current_setting('app.taxonomy_actor',true),'')::uuid))
      WITH CHECK (user_id=current_candidate_id() OR taxonomy_is_admin(NULLIF(current_setting('app.taxonomy_actor',true),'')::uuid))""")
    # Materialize matching IDs and Others for historical names using the same Python validator.
    # This is also available independently through the idempotent seed script.


def downgrade() -> None:
    # This migration contains user submissions. Preserve them and profile references.
    pass
