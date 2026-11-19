"""Education masters, shared specialization links and moderated submissions."""

from alembic import op

revision = "0025_education_taxonomy"
down_revision = "0024_single_specialization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.modules.education_taxonomy.models import (
        Course,
        CourseSpecialization,
        OtherSubmission,
        Qualification,
        Specialization,
    )

    bind = op.get_bind()
    for model in (Qualification, Course, Specialization, CourseSpecialization, OtherSubmission):
        model.__table__.create(bind, checkfirst=True)
        op.execute(f"GRANT SELECT,INSERT,UPDATE,DELETE ON {model.__tablename__} TO bharatpath_app")
        op.execute(f"GRANT SELECT ON {model.__tablename__} TO bharatpath_admin")
    op.execute("""
    CREATE OR REPLACE FUNCTION education_usage(p_level text,p_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT count(*) FROM candidate_profiles WHERE career->'details'->>
        (CASE p_level WHEN 'qualification' THEN 'highest_qualification_id' WHEN 'course' THEN 'course_id' WHEN 'specialization' THEN 'specialization_id' END)=p_id::text
    $$;
    """)
    op.execute("""
    CREATE OR REPLACE FUNCTION education_resolve(p_submission uuid,p_option uuid,p_actor uuid,p_action text,p_parent uuid)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
    DECLARE s education_other_submissions%ROWTYPE; entry education_other_submissions%ROWTYPE;
      child education_other_submissions%ROWTYPE; key text; option_name text;
      selected_course uuid; selected_qualification uuid; d jsonb; affected integer:=0; chain jsonb;
    BEGIN
      IF p_actor IS DISTINCT FROM NULLIF(current_setting('app.taxonomy_actor',true),'')::uuid
        OR NOT taxonomy_is_admin(p_actor) OR p_action NOT IN ('approve','merge','reject') THEN
        RAISE EXCEPTION 'education permission denied' USING ERRCODE='42501';
      END IF;
      SELECT * INTO s FROM education_other_submissions WHERE id=p_submission FOR UPDATE;
      IF NOT FOUND OR s.status<>'pending' THEN RAISE EXCEPTION 'submission changed' USING ERRCODE='40001'; END IF;
      key:=CASE s.level WHEN 'qualification' THEN 'highest_qualification' WHEN 'course' THEN 'course' WHEN 'specialization' THEN 'specialization' END;
      IF p_action<>'reject' THEN
        CASE s.level
          WHEN 'qualification' THEN SELECT name INTO option_name FROM qualifications WHERE id=p_option AND is_visible AND deleted_at IS NULL;
          WHEN 'course' THEN SELECT c.name,c.qualification_id INTO option_name,selected_qualification FROM education_courses c JOIN qualifications q ON q.id=c.qualification_id WHERE c.id=p_option AND c.is_visible AND c.deleted_at IS NULL AND q.is_visible AND q.deleted_at IS NULL;
          WHEN 'specialization' THEN
            SELECT sp.name,c.id,c.qualification_id INTO option_name,selected_course,selected_qualification FROM specializations sp
              JOIN course_specializations l ON l.specialization_id=sp.id JOIN education_courses c ON c.id=l.course_id JOIN qualifications q ON q.id=c.qualification_id
              WHERE sp.id=p_option AND l.course_id=p_parent AND sp.is_visible AND sp.deleted_at IS NULL AND l.is_visible AND l.deleted_at IS NULL
                AND c.is_visible AND c.deleted_at IS NULL AND q.is_visible AND q.deleted_at IS NULL;
        END CASE;
        IF option_name IS NULL THEN RAISE EXCEPTION 'invalid education target'; END IF;
      END IF;
      FOR entry IN SELECT * FROM education_other_submissions WHERE level=s.level AND context_key=s.context_key AND normalized_text=s.normalized_text AND status='pending' ORDER BY id FOR UPDATE LOOP
        UPDATE education_other_submissions SET status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'merge' THEN 'merged' ELSE 'rejected' END,
          resolved_option_id=p_option,resolved_by=p_actor,resolved_at=now(),updated_at=now(),version=version+1 WHERE id=entry.id;
        IF p_action<>'reject' THEN
          SELECT career->'details' INTO d FROM candidate_profiles WHERE user_id=entry.user_id FOR UPDATE;
          IF d->>key=entry.raw_text AND NULLIF(d->>(key||'_id'),'') IS NULL
             AND (NOT (entry.parent_chain ? 'qualification_id') OR d->>'highest_qualification_id'=entry.parent_chain->>'qualification_id')
             AND (NOT (entry.parent_chain ? 'course_id') OR d->>'course_id'=entry.parent_chain->>'course_id') THEN
            d:=d||jsonb_build_object(key,option_name,key||'_id',p_option::text);
            d:=jsonb_set(d,'{education_others}',coalesce(d->'education_others','{}')-key);
            IF selected_course IS NOT NULL THEN
              d:=d||jsonb_build_object('course_id',selected_course::text,'course',(SELECT name FROM education_courses WHERE id=selected_course));
              d:=jsonb_set(d,'{education_others}',coalesce(d->'education_others','{}')-'course');
            END IF;
            IF selected_qualification IS NOT NULL THEN
              d:=d||jsonb_build_object('highest_qualification_id',selected_qualification::text,'highest_qualification',(SELECT name FROM qualifications WHERE id=selected_qualification));
              d:=jsonb_set(d,'{education_others}',coalesce(d->'education_others','{}')-'highest_qualification');
            END IF;
            UPDATE candidate_profiles SET career=jsonb_set(career,'{details}',d),updated_at=now() WHERE user_id=entry.user_id;
            FOR child IN SELECT * FROM education_other_submissions WHERE user_id=entry.user_id AND status='pending' AND parent_chain->>(s.level||'_text')=entry.normalized_text FOR UPDATE LOOP
              chain:=(child.parent_chain-(s.level||'_text'))||jsonb_build_object(s.level||'_id',p_option::text);
              IF selected_qualification IS NOT NULL THEN chain:=(chain-'qualification_text')||jsonb_build_object('qualification_id',selected_qualification::text); END IF;
              UPDATE education_other_submissions SET parent_chain=chain,context_key=encode(sha256(convert_to(chain::text,'UTF8')),'hex'),
                parent_id=CASE WHEN (s.level='qualification' AND child.level='course') OR (s.level='course' AND child.level='specialization') THEN p_option ELSE child.parent_id END,
                updated_at=now(),version=version+1 WHERE id=child.id;
            END LOOP;
          END IF;
        END IF;
        affected:=affected+1;
      END LOOP;
      RETURN affected;
    END $$;
    """)
    for signature in ("education_usage(text,uuid)", "education_resolve(uuid,uuid,uuid,text,uuid)"):
        op.execute(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {signature} TO bharatpath_app")
    op.execute("ALTER TABLE education_other_submissions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE education_other_submissions FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY education_submissions_access ON education_other_submissions
      USING (user_id=current_candidate_id() OR taxonomy_is_admin(NULLIF(current_setting('app.taxonomy_actor',true),'')::uuid))
      WITH CHECK (user_id=current_candidate_id() OR taxonomy_is_admin(NULLIF(current_setting('app.taxonomy_actor',true),'')::uuid))""")


def downgrade() -> None:
    # Retain education references and suggestions rather than orphan profiles.
    pass
