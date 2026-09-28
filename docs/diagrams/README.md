# Architecture, data flows and scenarios

The companion to [`bharatpath-architecture.excalidraw`](bharatpath-architecture.excalidraw):
eleven diagrams on one canvas, drawn from the code as it stood on 2026-09-28.

**To open it:** go to <https://excalidraw.com> and use *Open* (or drag the file
onto the page), or use the VS Code "Excalidraw" extension. Every arrow is
bound to its boxes, so you can drag a box and its arrows follow.
`bharatpath-architecture.svg` is a flat preview of the same thing.

**To change it:** edit the data in [`gen_excalidraw.py`](gen_excalidraw.py)
and run `python docs/diagrams/gen_excalidraw.py`. If you edit the
`.excalidraw` file by hand instead, don't re-run the generator afterwards,
because it overwrites the file.

Colours are the same on every diagram: blue is a client or a person, green is
API code, yellow is a Celery task, violet is a data store, orange is an
external service, pink is a guard or invariant, and red dashed is either a gap
or a forbidden path.

---

## 1. System architecture

| Piece | What it is | Where it runs today |
|---|---|---|
| Four clients | Candidate app (native), employer, college and admin consoles (SPAs) | Phones; S3 + CloudFront for the web bundles |
| Edge | Caddy with TLS | Same EC2 host (an ALB after the ECS move) |
| `api` | FastAPI / uvicorn, one modular monolith with 21 modules | docker compose on one EC2 `t3.small` |
| `worker` | Celery, 17 registered tasks | Same image as `api` |
| `beat` | Celery Beat, **exactly one** | Same image as `api` |
| Postgres | The system of record: RLS, guard triggers, outbox, audit | A container on the host, EBS volume, **no backups** |
| Redis | Membership cache (60 s), rate limits, idempotency | A container on the host |
| SQS + DLQ | The Celery broker | AWS |
| S3 (6 buckets) | CVs, interview audio, export archives, … | AWS `ap-south-1` |
| Cognito (2 pools) | Identity only: candidates, and business users with TOTP MFA | AWS |
| OpenAI / Bedrock | Layer 1 CV extraction. Off by default, so scores stay PENDING | External |
| Textract | OCR, used only when local parsing returns almost no text | AWS `ap-south-1` (currently `SubscriptionRequired`, E2) |
| SES | Notification emails and Cognito codes | AWS |
| Sarvam and an evaluator | Speech-to-text and feedback for interviews | External, `none` by default |
| Payment gateway | Not chosen (D3). A **stub** signs real HMAC callbacks | — |

Everything differs between environments only by environment variables. The
image that passes CI is the image that runs.

## 2. One request

`Client → middleware (CORS, request id, per-IP limit) → JWT verified against
the right pool's JWKS → users by cognito_sub → memberships (Redis, 60 s) →
role / KYB / subscription guards (read live) → router → service → repository →
Postgres under RLS.`

What matters most for anyone drawing on this:

- **Authority lives in our database, not in the token.** A revoked membership
  takes effect on the next request (`mark_tenant_changed`), not when the token
  expires.
- **The service binds the tenant or the user** (`set_transaction_tenant` /
  `bind_candidate`). If it doesn't, RLS returns nothing, and that looks like a
  missing row rather than a bug.
- **One transaction** writes the business rows, the `audit_events` row and the
  `outbox` row. They commit together or not at all.
- Staff reads across tenants go through `admin._reveal`: the audit row is
  written first, then a read-only BYPASSRLS session is used.

## 3. Module map

The five surfaces are candidate, employer, college, money and platform. The
edges on this diagram are enforced by import-linter, not by convention:

- The add-ons, `integrity` and `notifications` never import `scoring`.
- `engagement` (streaks) and `scoring` are independent. Streak points never
  reach the 700–990 score.
- No other module imports `resume.repository` or `resume.models`, because
  `get_scorable_version` is the only door to a confirmed CV.
- `app.core` never imports a module.

## 4. The event backbone

`service tx → outbox row → (commit) → Beat every 30 s → outbox.relay (SKIP
LOCKED, batch 100) → routing.EVENT_SUBSCRIPTIONS → send_task → SQS → worker`.

| Event | Task(s) |
|---|---|
| `resume.version_confirmed` | `scoring.score_resume` |
| `scoring.score_computed` | `integrity.detect` |
| `courses.completion_recorded` | `scoring.rescore_for_addons` |
| `interview.session_completed` | `scoring.rescore_for_addons`, `interview.evaluate_session` |
| `billing.callback_received` | `billing.process_callback` |
| `applications.hire_disputed` | `admin.open_hire_dispute` |
| `privacy.export_requested` | `privacy.build_export` |
| 15 `NOTIFYING_EVENTS` | `notifications.dispatch` |
| **`resume.file_uploaded`** | **nothing** — see *Findings* |

The Beat sweeps run on the clock, not on events:

| When | Task |
|---|---|
| :05 | `applications.expire` |
| :15 | `subscriptions.renewals` |
| :25 | `privacy.erase_due` |
| :35 | `privacy.expire_exports` |
| :45 | `notifications.nudge_incomplete_profiles` |
| :55 | `notifications.send_orphaned` |
| 18:30 UTC (midnight IST) | `discovery.ensure_view_partitions` |

Delivery is at-least-once. Every consumer is therefore idempotent by what it
acts on: the file, the resume version, the callback, the dispute's application
or the notification's `dedupe_key`.

## 5–11. Scenarios

| # | Scenario | Rule to keep in view while drawing |
|---|---|---|
| 5 | **CV → score → visible**: presign, PUT, complete, parse (Textract only below `MIN_USEFUL_CHARS`), review, confirm, score (L1 model, L2+L3 code), `insert_score`, search document, integrity, `VISIBLE_CANDIDATES_CTE` | Only `version_confirmed` triggers scoring. The model never sees the weights. A missing model means PENDING, never a guess |
| 6 | **Employer**: sign up with MFA, create the organisation, invite a team, KYB (optional approval), subscribe, jobs, masked search, reveal (caps, then audit and view event in the same transaction) | The subscription *is* the access window. The masked card carries the band only |
| 7 | **Application stages**: SUBMITTED → VIEWED → SHORTLISTED → INTERVIEW → DECISION → HIRED, with REJECTED, WITHDRAWN and EXPIRED as exits and a dispute path | HIRED needs both parties to confirm. The DB trigger is generated from `applications.domain` |
| 8 | **Payment**: checkout (with an optional discount), PENDING payment, provider, HMAC callback, relay, `process_callback`, grant, then the renewal sweep with a 24 h pre-debit notice, GRACE and LAPSED | Only `process_callback` grants anything. The stub bypasses the bank, not the rules |
| 9 | **College**: seats, codes or a roster, invitations, the student's ROSTER consent and seat, an optional INDIVIDUAL grant, reads only through SECURITY DEFINER functions, floored analytics, revocation | A student never binds a college tenant. Revoking ROSTER ends INDIVIDUAL and frees the seat |
| 10 | **What moves the score**: course and interview completions re-score (+20 each, capped at +60). Evaluation, the questionnaire, streaks and integrity signals never do | A score row is insert-only and can be replayed without calling the model |
| 11 | **Privacy**: export (score but no breakdown, archive expires within about 49 h). Erasure after a 24 h cooling-off: S3 objects first, then one SQL cascade, `users` emptied and `cognito_sub` replaced by its hash | Half an erasure is a corrupt account. Payment and audit rows are retained by decision |

---

## Findings from the analysis

1. **Uploaded CVs are never parsed in a running system.**
   `resume.service.complete_upload` emits `resume.file_uploaded`
   (`backend/app/modules/resume/service.py:176`). But nothing in
   `app/tasks/routing.py` subscribes to that event, and `TASK_ARGUMENTS` has
   no entry for `resume.parse`. Nothing else enqueues `resume.parse` either,
   so no code path reaches the task.
   - **Effect:** an uploaded file's `parse_status` stays `QUEUED` for good.
     The paste and manual-form paths still work, because they create versions
     directly.
   - **Why the suite doesn't catch it:** the tests in
     `tests/integration/test_resume_intake.py` call `_parse()` directly and
     never go through the relay.
   - **Likely fix:** add a routing entry
     `"resume.file_uploaded": ("resume.parse",)` and an argument mapping
     `lambda e: {"resume_file_id": str(e["aggregate_id"])}`, plus a test in
     `test_outbox_relay.py`. It is not listed in `docs/blockers.md`.
   - **Note:** `docs/aws-deployment.md` §4.5 says uploading, parsing and
     scoring work, which would not be true for uploads.
2. **Postgres on the EC2 host has no backups** (`aws-deployment.md` §5.4).
   Diagram 1 marks this. It is known and deliberate for a test deployment.
3. **Beat is a singleton.** Running two schedulers runs every sweep twice.
   The sweeps are idempotent, so nothing is corrupted, but it is still a
   misconfiguration. When moving to ECS, keep the beat service at
   `desiredCount = 1`, and put its schedule file on EFS.
