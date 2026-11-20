# UAT demo scenario — 19 November 2026

## Additional unapplied jobs — 19 November 2026

Seed `uat-unapplied-jobs-20261119-v1` added 12 published jobs to
`yijajov274@forims.com` (Nakshatra Tech Solutions) in UAT RDS. All 12 had zero
applications after execution. Roles cover frontend, mobile, Python APIs,
full stack, QA, support, cloud, UI, analytics, graduate and senior engineering.
There are onsite, hybrid and remote positions, including fresher roles and
one undisclosed salary. Ten meet the demo student's current score and two
senior roles exercise the ineligible state. Titles have no demo prefix.

The script checks the exact UAT RDS hostname and approved employer ownership,
uses deterministic IDs and an advisory transaction lock, and preserves existing
jobs and applications. A second dry run created zero additional records.
No applications, payments or notifications were created. Execution script:
`D:/Bharatpath/tmp/seed_uat_unapplied_jobs.py`.

Reward correction: the learning fixtures now award the standard +30 for the
completed course and +20 for each of the three finished interviews (+60 cap).
The student's score increased from 755 to 845; resume base remains 755.
The previous zero-point setup described below is superseded. A normal scoring
service write appended a new score and replay verified its stored calculation.
Reports, answers, timestamps, session IDs and the in-progress state were
preserved. Only the seeded zero-point completed sessions were reconstructed
inside one transaction under the normal database triggers; no trigger was
disabled. Audit identifier: `uat-learning-rewards-20261119-v1`.
Backup: `/opt/bharatpath/backups/uat-before-rewards-20261119.dump`.

Display-label update: the `[UAT DEMO]` prefix was removed from all seeded
job/course titles and interview questions. Lesson titles now use `Lesson N`.
Internal identifiers and sample-data provenance remain for traceability.

## Courses and mock interviews added

Learning seed: `uat-learning-20261119-v1`, for the same supplied student.

| Course | State | Lesson progress |
| --- | --- | --- |
| [UAT DEMO] Problem Solving Essentials | Locked / not purchased | 0/6 |
| [UAT DEMO] Interview Preparation | Purchased / not started | 0/6 |
| [UAT DEMO] Software Engineering Foundations | In progress | 2/6 complete, third lesson partially watched |
| [UAT DEMO] Workplace Communication | Completed | 6/6 |

Each course contains two modules and six lessons (24 lessons total).
Lessons share a short MDN flower sample video stored in UAT S3. They test
playback/progress/completion and are labelled demo content, not real training.

Five interview sessions cover EVALUATED (Ready report), COMPLETED (Pending
report), FAILED (no-speech failure report), ABANDONED and IN_PROGRESS.
The in-progress session has two stored answers and can be resumed. Existing
open sessions are preserved by the seed rather than replaced. The evaluated
session contains six questions, clearly labelled demo transcripts and feedback.
Audio is a real playable silent WAV fixture in UAT S3, not the student's voice.

Purchase prerequisites use synthetic `uat_fixture` payment records, labelled
as fixtures in their metadata. Their nominal amounts are test ledger data;
no payment gateway was contacted and no actual charges occurred. Course and
interview contributions are explicitly zero for these fixtures so they do not
inflate the student's score. No model, speech or notification calls were made.

Both seeds preserve records on repeat execution. The application services
successfully read all four course states and Ready/Pending/Failed reports;
S3 object checks verified the demo media. Rendering on a physical device was
not tested. Backup before learning seed:
`/opt/bharatpath/backups/uat-before-learning-20261119.dump`.
Local execution/verification scripts:
`D:/Bharatpath/tmp/seed_uat_learning.py` and
`D:/Bharatpath/tmp/verify_uat_learning.py`.

Seed identifier: `uat-three-profiles-20261119-v1`.
Target: UAT RDS through EC2 `13.235.1.169`. Production was not modified.

## Accounts

| Portal | Account | Scenario |
| --- | --- | --- |
| Employer | yijajov274@forims.com | Nakshatra Tech Solutions; existing approved organisation and subscription retained |
| College | baberib183@anonmart.com | Existing institute enriched with demo roster/import/code states; verification set for UAT testing |
| Student | sabeyeg532@bcough.com | Existing Sam Vashisht profile, resume and score retained; skills, headline and preferences enriched |

No passwords were changed or written into the seed script.

## Employer jobs and student applications

All generated jobs begin `[UAT DEMO]`. They contain responsibilities,
qualifications, salary ranges, skills, education, benefits, work/location
options, application deadlines, hiring rounds and internal hiring settings.

| Job | Application scenario / job state |
| --- | --- |
| Frontend Engineer | Submitted |
| Backend Engineer | Viewed |
| Full Stack Developer | Shortlisted |
| QA Automation Engineer | Interview scheduled |
| Platform Engineer | Decision |
| Software Engineer | Hired; both confirmations recorded |
| Data Analyst | Rejected |
| API Developer | Withdrawn |
| Support Engineer | Expired |
| Cloud Engineer | Decision; employer proposed hire, candidate confirmation pending |
| Integration Engineer | Decision; employer proposed hire, candidate disputed |
| React Developer | Published; available for a new application |
| Python Developer | Published; available for a new application |
| Product Engineer | Draft |
| DevOps Engineer | Paused |
| Graduate Engineer | Closed |

Total: 16 jobs (13 published, one each draft/paused/closed), 11 applications.
Application history records the legal stage sequence; transitions and hire
confirmation constraints remained enabled. Interview fixtures have in-app
messages and clearly synthetic `example.invalid` meeting links.

## College scenarios

- 16 committed roster entries: 12 accepted, one pending, one sent, one declined
  and one expired.
- 12 linked students: the supplied student plus 11 clearly named synthetic
  students with non-deliverable `example.invalid` emails and no Cognito login.
- Nine individual-visibility fixtures and three roster-only fixtures, producing
  LINKED and CONSENT_PENDING screen states. These are UAT consent fixtures,
  not records of genuine consent by real students.
- Three imports: committed, preview and discarded. Preview contains one valid,
  one invalid and one duplicate entry.
- Three referral codes: active, expired and revoked.
- Seat allowance is at least 25; this is capacity, not 25 paid or used seats.
- Zero-priced, inactive-catalogue UAT fixture plans provide missing active
  college/student test entitlements for 30 days. Existing active subscriptions
  are preserved. No settled payments or real financial transactions are fabricated.

Synthetic extra students intentionally have no fabricated resumes, scores,
course completions or interview recordings. Their empty/unscored states are
available for testing, alongside the supplied student's existing records.

## Verification and recovery

The seed was dry-run in a transaction and rolled back before applying.
A logical database backup was created on the UAT host at
`/opt/bharatpath/backups/uat-before-profiles-20261119.dump` before committing.
The commit writes an `uat.demo.seed` audit event with the seed identifier.
Stable IDs and the audit marker prevent duplicate reruns. Re-running after
manual testing preserves the changed fixtures rather than resetting them.

Application services were checked using `bharatpath_app` (the regular RLS
role), not just the privileged migration connection. Employer jobs and
applications, student applications, and college roster reads succeeded.
The college list showed 9 LINKED, 3 CONSENT_PENDING and 1 INVITED entries;
declined, pending and expired invitations are inspected in roster/import views.
No emails, SMS, push deliveries or notification outbox entries were created by
this seed. UI/device rendering has not been verified in this seeding run.

The execution and verification scripts are retained locally under
`D:/Bharatpath/tmp/seed_uat_profiles.py` and
`D:/Bharatpath/tmp/verify_uat_profiles.py`, and in the UAT container's `/tmp`.
The seed refuses any RDS hostname other than the specified UAT database.
Do not restore the entire backup merely to reset demo fixtures: that would
also revert unrelated work performed since the backup. Use reviewed cleanup
by seed IDs if removal is needed.
