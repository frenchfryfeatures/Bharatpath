# Blocker register

> ## 2026-09-18 — sign-up and login decisions (client note)
> `docs/Signup_Login_Discussion_Updates .pdf`, built the same day
> (`docs/signup-and-accounts.md`). **E7 closed** (anyone signs up) ·
> **D1 and D2 deferred by the client**, with phone OTP and every SMS: sign-in
> is email and password, every code and message goes by email or in-app ·
> **E9 narrowed** (invited colleagues now get a Cognito email) · new: **E35**
> (roster contacts given by phone alone hear nothing), **E36** (discount
> policy is a placeholder), ~~E37~~ (business MFA: optional, closed 2026-10-07),
> **E38** (the client's sending domain).

> ## 2026-09-22 — AWS deployment, the scheduler, and six languages
> **E4 half closed**: all seven periodic sweeps now run on **Celery Beat**
> (`app/tasks/schedule.py`). Until today nothing ran any of them, so no payment
> settled, no notification was dispatched and no accepted deletion request was
> carried out. **E34 closed** (S3 lifecycle on export archives). **E38
> narrowed**: SES can now verify a single mailbox while the client has no
> domain, though the SES *sandbox* still means no real candidate receives
> anything. **E24 was stale** and is largely closed (Sarvam + OpenAI, chosen
> 2026-09-18). New: **E39** (six languages, written by us), **E40** (the test
> deployment is not production), **E41** (Cognito pools cannot move accounts).
> A single-host EC2 deployment is written and documented:
> [`aws-deployment.md`](aws-deployment.md), [`payments-bypass.md`](payments-bypass.md),
> [`malware-scanning.md`](malware-scanning.md).

> ## 2026-09-22 (later) — E5 closed: hidden text is read
> `HIDDEN_TEXT` was one of only two rules permitted to reach HIGH, and it
> could not fire at any input because nothing ever populated
> `ResumeClaims.hidden_text`. White-on-white keyword stuffing — the most
> widely documented way of gaming a CV screen — produced **no signal at all**.
> It now raises HIGH. `raw_text` is unchanged, so no score moves.

> ## ✅ Round 7 (2026-09-11) closed ten of these
> **A1** scoring weights (delegated to us — rubric now in `scoring/domain.py`) ·
> **B1/N2** CV text may leave India · **B2/Q12** score never explained ·
> **B3/Q13** full delete, with a financial/audit carve-out flagged ·
> **B5** dishonest-CV rules (delegated to us) · **B6/N5** pay-monthly-see-everyone
> confirmed · **B8/N6** typed referral code approved · **B9/Q10** college seat
> model approved · **D1** TRAI DLT started · **D2** Twilio started ·
> **D5** Apple Developer declared not needed.
>
> **Remaining: A2 (calibration CVs), B4 (employer lists — question returned to
> client), and the content in category C, which we are now producing as
> placeholders.** See `answers-log.md` Round 7 for the verbatim answers.

> ## ✅ 2026-09-12 — the delegated work is delivered
> **B5** dishonest-CV rules **built** (`integrity/domain.py`, 8 rules, 40 tests) ·
> **B4** employer and industry lists **confirmed and built** ·
> **C1–C8 downgraded**: every one now has a placeholder that the build runs
> against, each carrying a flag a test asserts (`PLACEHOLDER_PRICING`,
> `HAS_MEDIA`, `dlt_template_id is None`, `FORM_VERSION`).
>
> **What that changes, and what it does not.** Nothing in category C blocks code
> any more. All of it still blocks launch, because a placeholder is ours and the
> product is the client's. The flags exist so that stays visible: turning one off
> is a decision somebody has to take deliberately.
>
> **C7 (brand) is the honest exception.** A design *system* is delivered —
> colour, type, spacing, accessibility, and one rule about how the score may be
> drawn. A brand identity is not, and should not be faked.

Everything currently blocking BharatPath, in one place. Compiled 2026-09-11 from
`plan.md` §13, `questions.txt`, `resources-needed.md`, and findings from the
build itself.

**Read the categories carefully — they mean different things.** A "launch
blocker" costs nothing today and everything on the day you ship. A "build
blocker" stops work now. Mixing them is how the expensive ones get discovered
late.

| Category | Meaning | Count |
|---|---|---|
| **A** | Stops code being written **now** | 2 |
| **B** | Blocks a specific plan day | 9 |
| **C** | Blocks launch, not code | 11 |
| **D** | Long lead time — outlasts the sprint | 5 |
| **E** | Found during the build | 26 open of 33 raised |

*(The E count was stale from Day 6 until Day 20 — it said 4 while the section
held 33 items. Counted from the section itself now, struck-through rows
excluded.)*

---

## A. Stops work now

| # | Blocker | Owner | Blocks | Status |
|---|---|---|---|---|
| **A1** | **Scoring weights and dimension definitions** | Client | **Day 8** — the next high-judgment day | Open. NDA-gated. The arithmetic sent 2026-08-27 does not close to 990 (`questions.txt` Q1). Day 8 ships `v0-placeholder` with invented weights until this lands. |
| ~~**A2**~~ | ~~**Calibration corpus — 50–100 real CVs with expected bands**~~ | Client | ~~Day 8~~ | ✅ **CLOSED 2026-09-12.** Resolved a different way than asked: rather than supplying real CVs, the client reviewed our 35 synthetic profiles with the live engine's scores and accepted all of them (*"the scores are perfect fine"*). The rubric is now agreed rather than merely consistent. **The corpus is still synthetic** — a systematic gap between these profiles and the CVs that actually arrive stays invisible, so re-run this against thirty real CVs once thirty exist. |

> Day 8 can be *built* without these — the engine is `base + bounded
> contributions, clamped` regardless. It cannot be **calibrated**, and a score
> nobody calibrated is a number, not a judgment.

---

## B. Blocks a specific plan day

| # | Blocker | Owner | Blocks | Status |
|---|---|---|---|---|
| **B1** | **N2 — may CV text leave India?** | Client | Day 8 | Open. Bedrock cannot pin inference geography, so this decides which client library Day 8 is built against. Mitigated for now: everything runs in `ap-south-1`. |
| **B2** | **Q12 — written rescission of the score-explanation criterion** | Client | Day 8 | Outstanding. "The score is never explained" contradicts PRD §4.2. Three of four confirmations received; this is the fourth. |
| **B3** | **Q13 — deletion vs. audit retention** | Client's counsel | Day 20 | ◐ **Carve-out confirmed 2026-09-15; the erasure is built (Day 20).** Every table in the schema is classified in `privacy.domain.ERASURE_PLAN` and the cascade is `erase_candidate`, one SECURITY DEFINER function, with an invariant test holding the two together. Personal data is destroyed; payments, `audit_events` and `candidate_view_events` survive, pointing at a `users` row emptied of every identifier. **Three things are still owed, and none of them is code:** (1) **the retention period** on what survives, which also decides when a view-log partition may be detached -- until it lands `RETENTION_POLICY_VERSION` starts `placeholder-` and retained rows are kept indefinitely; (2) **counsel's view on two judgment calls we took**: an erasure deletes the candidate's `applications` and their stage history, which removes something from an employer's workspace, and it deletes `disputes` they raised, which is also our record of how we handled a case; (3) **`roster_entries` are not reached** -- a college's own record of a contact it supplied carries no link to an account, deliberately (SRS 1.15), so a request against us cannot find it and it is the college's to erase. |
| **B4** | ~~Employer type and industry lists~~ | Client | Day 9 | ✅ **Closed 2026-09-11.** Confirmed by the client and built as closed vocabularies — 9 types, 19 industries, `employer/reference.py`. Codes are never renamed; retirement is `active=False`. |
| **B5** | ~~Integrity-detection rules~~ | Client → us | Day 9 | ✅ **Closed 2026-09-12.** Delegated to us in Round 7.6 and built: 8 rules in `integrity/domain.py`, 40 tests. Duplicate detection stays dropped (R6). **The reviewable decision is the severity policy**, not the rules — only two rules may reach HIGH, because HIGH hides a candidate from search before a human has looked. |
| **B6** | **N5 — rescission of the unlock criteria** | Client | Day 13 | ⚠️ **Never asked.** The largest reversal in the project: R14 voids a documented flow, a lifecycle, two interface specs and **five acceptance criteria the build is graded against** (SRS §2.25.2 carries three that cannot pass as written). The build is right and the criteria are stale — which is exactly what a written rescission exists to record. |
| ~~**B7**~~ | ~~N4 — written acknowledgement of the bulk-extraction risk~~ | Client | Day 14 | ✅ **Acknowledged 2026-09-15.** The client accepts the residual risk of auto-approved KYB plus whole-database access. The Day 14 caps, burst limit, alerts and no-export rule stay as the mitigation. |
| ~~**B8**~~ | ~~N6 — referral-code consent vs. PRD rule 8~~ | Client | Day 17 | ✅ **Closed 2026-09-11** (Round 7.9, *"do it"*) and **built 2026-09-17**, alongside invite-and-accept: entering a code is ROSTER consent only, the code is named on the consent row. |
| ~~**B9**~~ | ~~Q10 — college seat model~~ | Client | Day 17 | ✅ **Closed 2026-09-11** (Round 7.7, *"yes"*) and **built 2026-09-17**: one payment per period for up to N students; the student past N is linked and not seated. |

---

## C. Blocks launch, not code

Nothing here stops a single line being written. All of it stops shipping.

**C1–C8 and C10 now have placeholders we produced** (Round 7.10, 2026-09-12).
Each row says what exists and what is still owed. The *"still owed"* column is
the one to read: a placeholder removes the build dependency and nothing else.

| # | Blocker | Placeholder built | Still owed by the client |
|---|---|---|---|
| **C1** | **Course content** | Syllabus outline: 6 modules, 18 lessons (`courses/catalogue.py`). Since 2026-09-29 staff build the real course in the console from YouTube links or uploads | **The recordings** — nothing is on sale until staff publish a course with a playable lesson. **Completion is answered** (answers-log 11.5): every published lesson watched. |
| **C2** | **N8 — plans, prices, catalogue** | Full price list, 11 plans + 2 one-off products (`subscriptions/catalogue.py`) | **Real prices.** Ours are benchmarked against the Indian market, not against a margin — the per-candidate cost figure that would set one does not exist (`scoring-approach.md` §12). `PLACEHOLDER_PRICING` is the flag to flip. |
| **C3** | **Questionnaire bank** | 12 questions, 4 sections, all skippable (`questionnaire/bank.py`) | Review. **Note what we excluded and why**: marital status, gender, religion, caste, photograph. Re-adding any of them is a client decision with counsel, not a field somebody adds. |
| **C4** | **Interview bank + rubric** | 3 sets × 6 questions, 5-dimension rubric with anchors (`interview/bank.py`) | Review. Accent, fluency, pace and pitch are deliberately not assessed. |
| ◐ **C5** | **N9 — locale strings** | **9 locales.** The client's six (English, Hindi, Bengali, Kannada, Marathi, **Punjabi**) carry all **159** keys as of 2026-09-22 — every form label, interview question, questionnaire prompt and notification body. Gujarati, Tamil and Telugu keep the 32 core strings and fall back to English per key. | **A native-speaker pass on all eight non-English bundles.** Every one is flagged `needs_native_speaker_pass: true` in its `_meta`, and `test_locales.py` fails if that flag is dropped — flipping it is a claim that a qualified person read it. See **E39**. |
| **C6** | **Notification templates** | 38 drafted: 19 SMS, 6 email, 13 in-app (`notifications/templates.py`); Day 19 added the nudge and the roster invitation | **DLT registration** (D1, 2–4 weeks) for the 19 SMS bodies. Every `dlt_template_id` is `None` and sending is gated on it — an unregistered body is dropped silently by the operator. The drafts exist so registration can start now. |
| **C7** | **Brand identity and design** | Design *system* only: colour, type, spacing, states, accessibility, and one rule on drawing the score (`docs/design-system.md`) | **A designer.** Logo, wordmark, illustration and photographic direction, iconography, the score screen. Deliberately not faked — a competent-looking placeholder logo gets shipped and then defended. |
| **C8** | **Onboarding form fields** | KYB 27 fields, college 20 (`kyb/forms.py`, `college/forms.py`) | Review, plus the Indian states reference list the `state` fields point at. |
| **C9** | **Production API contracts and data schemas** | — | Reconciliation. NDA-gated (PRD §10). |
| **C10** | **Eligibility message copy** | `eligibility.below_threshold` in all 8 locales, with a test asserting it contains no digits | Sign-off on the wording. It says the requirement is not met and nothing else — the score is never explained. |
| ~~**C11**~~ | ~~R18 duplicate-detection confirmation~~ | — | ✅ **Confirmed dropped 2026-09-15.** No duplicate-CV detection. |
| ~~**C13**~~ | ~~Application expiry period~~ | 30 days of employer silence | ✅ **Accepted 2026-09-15** as the client's number. `config_values` `applications.expiry` still changes it without a deploy. |
| ~~**C12**~~ | ~~**Do seats replace a student's own subscription?**~~ | 2026-09-12 | ✅ **CLOSED — "Student does not pay if the college has paid for it."** The seat covers them entirely. College prices rebuilt on that basis (~2.7x; per-seat yield 13% → 37–47% of direct, ex-tax) and a floor test added so it cannot drift back. Entitlement for Day 15/17 is settled: **personal subscription OR active seat**. See `answers-log.md` Round 8 — which also lists three follow-on questions this opens (a student who already paid, non-renewal, and whether a seat covers the paid add-ons). |

---

## D. Long lead time — outlasts the sprint

**These are the ones that hurt.** Each is longer than the work it blocks, so
starting late cannot be recovered by working faster.

| # | Item | Lead time | Owner | Status |
|---|---|---|---|---|
| ⏸ **D1** | **TRAI DLT registration** | **2–4 weeks** | Client | **Deferred by the client 2026-09-18**, with every SMS: nothing is sent by SMS until the organisation's registration exists. Started 2026-09-11 on the entity side. Binds the sender, not the gateway. The 19 SMS drafts are kept, unregistered, and no event routes to them (`test_nothing_is_sent_by_sms`). |
| ⏸ **D2** | **Twilio account + Verify service** | Days | Client | **Deferred by the client 2026-09-18**: no phone OTP. `/auth/otp/start` is registered only behind `AUTH_PHONE_OTP_ENABLED`; `ALLOW_CUSTOM_AUTH` and the Twilio secret are gone from Terraform. Bringing phone OTP back is the three Lambda triggers, SMS delivery, and that flag. |
| **D3** | **Payment gateway KYC** | 1–2 weeks | Client | ❌ Not started. Blocks all revenue. **Must be confirmed to support recurring billing** (UPI e-mandate, R17). Day 15 built both renewal paths behind `PaymentProvider` with a stub; the real gateway is one adapter, plus its callback format in `billing.domain.parse_callback`. |
| **D4** | **Legal review of the scoring model** | Weeks | Client's counsel | ❌ Not started — confirmed by the client 2026-09-15. Selling an item that raises a three-digit consumer score is a different proposition from giving that score away free. |
| **D5** | **Apple Developer (organisation)** | 1–3 weeks | Client | ❌ Not started. Needs a D-U-N-S number, which is its own separate application. |

Also pending, shorter: **SES production access** (3–7 days, AWS reviews manually
and rejects vague requests) — **now on the critical path (E38)**, since email is
the only channel outside the app — and **Google OAuth client** (hours — blocks
Google federation on the candidate pool).

---

## E. Found during the build

Technical, ours to fix, recorded so they are not rediscovered.

| # | Item | Blocks | Status |
|---|---|---|---|
| **E1** | **No malware scanning** | LAUNCH | `app/modules/resume/scanner.py` is a seam with nothing behind it. It records `PENDING`, never `CLEAN` -- recording CLEAN from something that scans nothing would be a lie told to whoever later decides a file is safe to parse. **Does not block any API flow**: `PROCESSABLE` includes PENDING and `RESUME_SCAN_ENABLED` defaults false, so uploads, parsing and scoring all work. **GuardDuty Malware Protection for S3** is the intended implementation (blocked on E2). **[`docs/malware-scanning.md`](malware-scanning.md) written 2026-09-22** with the Terraform, the tag-reading scanner, and the honest note that enabling it is not one line: scanning is asynchronous, so narrowing `PROCESSABLE` to `{CLEAN}` means parsing must retry on PENDING or trigger on the tagging event. |
| **E2** | **AWS service activation (Textract, GuardDuty, Bedrock)** | OCR for scanned CVs, malware scanning, scoring | **Still blocked on 2026-09-13, checked live.** Textract and GuardDuty return `SubscriptionRequiredException`, in two regions. Bedrock no longer says the account is being verified, but every model, Amazon Nova included, returns `Operation not allowed`. Claude additionally shows `NOT_AUTHORIZED`, and the Anthropic use-case form is unsubmitted. The Health dashboard does not show per-account activation. **Action: AWS support case (Account and billing → Service activation), plus the use-case form for the chosen model.** Verify with `backend/scripts/verify_ocr_fallback.py`. |
| ~~**E3**~~ | ~~Legacy `.doc` (OLE2) files~~ | — | ✅ **Closed 2026-09-15 — no longer accepted.** Refused at upload as `upload_legacy_doc_unsupported` so the app can say "save as PDF or .docx"; the parser keeps its refusal for any file accepted earlier. |
| ◐ **E4** | **Deployment infrastructure, and every sweep that needs a schedule** | Day 20 | **The schedule half is CLOSED 2026-09-22.** All seven periodic tasks now run on **Celery Beat** (`app/tasks/schedule.py`, `tests/unit/test_beat_schedule.py`): outbox relay every 30s, five hourly sweeps staggered across the hour, view-partition creation daily at 00:00 IST. `worker.py` had said Beat could not work on an SQS broker because SQS has no ETA/countdown -- true of `apply_async(countdown=...)`, and irrelevant to Beat, which never asks the broker to delay anything. The EventBridge trigger endpoint that docstring described was never built, so from Day 12 until now **no payment settled, no notification dispatched and no accepted deletion carried out** outside tests. **Run exactly one beat process** -- it is a clock, not a worker. **Still open: the infrastructure.** A single EC2 + docker compose test deployment is written (`infra/terraform/ec2.tf`, `deploy/docker-compose.prod.yml`, `docs/aws-deployment.md`) and is deliberately not production: no managed backups, no HA, no zero-downtime deploy. RDS/ElastiCache/ECS/ALB is §7 of that document. |
| ✅ **E5** | ~~Hidden text is not extracted~~ | The best integrity rule we have | **Closed 2026-09-22.** `app/modules/resume/hidden_text.py` reads the PDF content stream through pypdf's operand and text visitors and reports text a reader cannot see: **invisible render mode** (`3 Tr`, `7 Tr`), **near-white fill** (`rg`/`g`/`k`/`scn`, luminance >= 0.92), **sub-point type** after the text and current transformation matrices, and **off-page** positioning beyond an inch outside the MediaBox. `q`/`Q` restore colour, so a template that wraps a white element in a save/restore is not flagged. .docx covers Word's `w:vanish` and white runs. **`raw_text` is byte-identical** -- pypdf always returned hidden text in it, so no score moves and nothing needs re-scoring; the hidden part is now *identified* rather than subtracted, and stored beside it in `parsed`. **Two false positives are refused deliberately**: an OCR text layer over a scan (every character is mode 3 -- reported only when invisible text is a minority of the document) and light-grey body text. **What changed in practice**: white-on-white keyword stuffing previously raised *no signal at all*; it now raises `HIDDEN_TEXT` / HIGH. `INJECTED_INSTRUCTIONS` always fired -- the pattern matched in `raw_text` either way -- but its `in_hidden_text` evidence was hardcoded False by the empty default, so a reviewer could not tell a deliberate injection from a candidate quoting the phrase. That distinction is the basis for rating it HIGH, and it is now real. 36 tests, `tests/unit/test_hidden_text.py`. **Owed: versions parsed before today carry no analysis** (`was_analysed` is False for them) and are not re-checked -- a re-run over existing CVs is a decision, not a migration. |
| ~~**E6**~~ | ~~**Manual-form resumes are never scored**~~ | — | ✅ **Fixed in code 2026-09-13.** A structured version is rendered to text, without the name or the graduation year, and goes through Layer 1 like an upload. Scoring the form directly was rejected: it would give zero for the three judgments only the model makes. Scores still wait on E2 and a model choice. |
| ~~**E7**~~ | ~~Business sign-up is admin-only~~ | — | ✅ **Closed 2026-09-18 by the client** ("they can themselves also do"). `allow_admin_create_user_only = false` on the business pool (Terraform, **not yet applied**). Staff can still create employers and colleges from the console. |
| **E8** | **One address cannot be both a candidate and employer staff** | Recruiters who are also job-hunting | `users.email` is unique across both pools, so a recruiter who is also a candidate needs two addresses. Deliberate for now: merging identities across pools with different assurance (the business pool requires MFA) is a design of its own. |
| ◐ **E9** | **Adding a team member still reveals that an address exists** | Privacy | Candidate and other-employer addresses get one identical refusal, so *which* is never revealed. That a refusal differs from success still is. **2026-09-18**: an added colleague who has never signed in now gets Cognito's temporary-password email, so the invitation half exists; the refusal still differs from success. |
| ~~**E11**~~ | ~~Interview links go to candidates from any https host~~ | — | ✅ **Decided 2026-09-15: do not limit.** Any https meeting link stays allowed; the Day 12 checks (https, a real host, no credentials, no `javascript:`) remain. |
| **E12** | **A disputed hire has a queue and a reviewer, and no remedy** | Hire disputes | ◐ **Day 19**: a candidate's dispute is filed in `/admin/disputes` as theirs, cross-linked to the application's two sides and the candidate's live integrity signals, and staff resolve it with words both can read. **Resolving changes nothing else**: the application stays unconfirmed until the candidate confirms, the employer rejects, or the candidate withdraws. Whether staff may confirm or void a hire is a client decision, and a new transition in `guard_application_write`. |
| ~~**E10**~~ | ~~No platform-staff account can exist~~ | — | ✅ **Closed 2026-09-17 (Day 19)** on the recommendation: one PLATFORM tenant for our staff (`uq_tenants_one_platform`). `guard_membership_tenant_type` holds every role to its kind of tenant for every writer, so no employer can add a staff role. Staff are provisioned by `scripts/create_platform_staff.py`, never by a route; the Cognito business-pool user is created separately. |
| ~~**E13**~~ | ~~A revealed profile has no name unless the candidate used the form~~ | — | ✅ **Built 2026-09-15.** The client chose to ask the name at sign-up: `PUT /candidate/profile/name` stores `candidate_profiles.full_name` (letters, spaces, `. ' -`, any script). The reveal shows it, falling back to the structured form's name; a masked card never can. **The app's sign-up screen must ask for it** — the API does not refuse other actions without one. |
| ◐ **E15** | **Outbox events reach a broker in code; nothing runs the relay** | Every sale, re-scores, notifications | **Day 19**: `_publish` enqueues every subscribed task by name with arguments built in `routing.TASK_ARGUMENTS` (checked against each registered task's signature), and raises on a broker failure so the row is retried. **Found and fixed on the way**: `include=["app.tasks"]` registered no task at all -- the worker now includes every module by name. Still owed: the relay's own schedule and the SQS queue URL in a deployed worker (**E4**). Until then `POST /billing/dev/payments/{id}/simulate` remains the local path. |
| **E16** | **Plans above ₹15,000 cannot renew automatically** | R17 for employers and colleges | A UPI mandate may debit without per-debit approval only up to RBI's limit, so registration refuses a plan priced above `mandate_max_amount_minor` (config, ₹15,000). That excludes employer annual (₹47,999) and every college plan. Our reading of the rule; **confirm with the chosen gateway** (D3), which may offer card or net-banking e-mandates with other limits. |
| **E17** | **Resume upload and confirmation are open to non-payers** | Model spend, and R13's reading | The score is paywalled; parsing a CV is not, by decision, because uploading before paying is where a candidate is converted. But confirming triggers a Layer 1 model call, so every non-paying sign-up can cost a model call. **Needs a client decision**: keep it (acquisition cost), or put confirmation behind the subscription. |
| **E18** | **No refund flow** | Customer support, disputes | REFUNDED exists as a payment status and nothing writes it. Cancellation stops renewal at period end with no refund. The refund policy (pro rata, none, within N days) is the client's to set. |
| ~~**E14**~~ | ~~View-anomaly alerts are written, and nobody can read them~~ | — | ✅ **Closed 2026-09-17 (Day 19).** `GET /admin/audit-events?action=candidate_view_anomaly_flagged` reads them, and the employer drill-down counts the last 30 days beside distinct candidates viewed. Nobody is *told* of a new one yet: a staff alert channel is not built. |
| **E19** | **An interview session earns +20 on completion, before anyone has heard it** | Interview points at launch | Day 16 follows the plan: six answers stored is a completed session and +20. The server checks each answer is real audio of 1 KB+ and 1–125 s, and nothing more, so six seconds of silence earns the same as six real answers. Transcription and evaluation (Day 17) could hold the points until a transcript shows speech, but that moves the score hours later and makes a failed transcription a lost +20. **Client decision: points on completion (today) or on evaluation.** **Day 17 makes it visible**: a session with no speech in any answer is evaluated FAILED `no_speech`, and still keeps its +20. |
| **E20** | **An interrupted session can only be resumed, never abandoned** | Support | A session stays open until completed; starting again returns it, which is the recovery path. There is no route or sweep to abandon one, so a candidate who wants to give up cannot free the purchase, and nothing ever moves a session to ABANDONED. Needs a policy first: does abandoning refund the purchase, return it, or spend it? |
| **E21** | **Questionnaire answers reach no employer yet** | The questionnaire's value | Day 16 stores, validates and reports them to the candidate. Employer search does not filter on them and a masked card does not show them; `ACCESSIBILITY_ADJUSTMENTS` is meant to reach only an employer the candidate applied to, and that sharing is not built. Deliberately **no badge**: a badge means an add-on folded into the score (`discovery/domain.py`). Filters are a discovery change (search document and trigger). |
| ~~**E23**~~ | ~~Seat allocation has no route~~ | — | ✅ **Closed 2026-09-17 (Day 19):** `PUT /admin/colleges/{tenant_id}/seats`, PLATFORM_ADMIN only, through the same capped and audited service. |
| ◐ **E24** | ~~No speech model or evaluator is chosen~~ | Interview feedback | **Largely closed 2026-09-18** and this row was stale: **Sarvam `saaras:v3`** (mode `codemix`, language auto-detected, processed in India) transcribes, and **OpenAI `gpt-5.4-mini-2026-03-17`** evaluates against the rubric with instructions forbidding any judgement of accent, fluency, vocabulary, pace or filler words. Both live-tested the same day. Providers still default to `none`, so a deployment must set the keys deliberately. **Still owed: a test on real recordings in each supported language** before launch, which now means six (E39). Transcripts inherit **E22**'s retention question. |
| **E25** | **What a student loses when their college stops paying** | Round 8 follow-ons | Built as a hard cutoff: the next request after the college's period ends is refused, seat and link kept. No grace period, no notice (Round 8 question 2). A student with their own subscription keeps it alongside a seat (question 1). A seat covers the subscription gate only; courses and interviews are still bought (question 3). All three need the client's answer before the first college contract. |
| **E22** | **No retention period for interview audio** | DPDP, S3 cost | Recordings of a candidate's voice are kept indefinitely in `bharatpath-interview-audio`, with no lifecycle rule. Rejected uploads are deleted at once; accepted ones are needed for Day 17's transcription and for disputes. **Counsel and client: how long after evaluation?** Then one lifecycle rule in `infra/terraform/s3.tf`. |
| **E26** | **Cohort filters have nothing to filter on** | SRS 2.10.4 filters (cohort, course, branch, graduation year) | Day 18 analytics describe the whole linked cohort. No table holds a student's course, branch or year: the roster reads contact and a name only, deliberately, and a referral code carries no label. **Two questions first**: who declares the dimension (the college on a roster column or a code, or the student), and what floor applies per filtered cohort -- every filter is a new way to subtract one student from another, so each filtered cohort gets the same floor and suppression, and a college with small branches will see mostly `null`. |
| **E27** | **What a college sees of a consenting student, and the words for it, are ours** | Counsel, client | `GET /college/students/{id}` returns a name, the display score and band, application and interview counts, and platform hires with the employer's name -- our choice, fixed by an invariant test and named in `INDIVIDUAL_CONSENT_TEXT`, which is a placeholder like the roster text. The analytics floors (10 students, median to 10) are ours too; **the cell floor is answered: exact numbers, `min_cell_size` 1 (client, 2026-09-30, answers-log 12.1)**. **Counsel: the INDIVIDUAL words. Client: the field list and the cohort floor.** Widening the view means new words and a new version. |
| **E28** | **A dashboard read before and after one named student links can show their band** | DPDP, college trust | A college knows from its own roster who accepted an invitation. Reading the overview before and after that student links (or revokes) shows which band moved, unless the cell is suppressed. Cell suppression narrows this; only delaying additions (e.g. a daily snapshot, with revocations still immediate) or adding noise removes it. **Built as floors and suppression only**, and the college-facing revocation message (Day 19) must not name the student. Counsel to accept the residual, or the client to pay for a snapshot. **2026-09-30: cell suppression is off by default (answers-log 12.1), which widens this, and the client accepted the residual (12.2). Counsel not yet asked.** |
| **E29** | **Suspending a college stops its students' seat access** | Client decision before the first college contract | Suspension sets `tenants.status = SUSPENDED` (`guard_tenant_suspension_write`), and the seat limb, a college's invitations and its referral codes all read ACTIVE, so a suspended college's seated students are refused on their next paywalled request -- the college's fraud becomes their lockout. Their link, seat row and any personal subscription are untouched. Built this way because the alternative (seats outliving the college's suspension) keeps paying for a tenant we have stopped. **Client: is that right, or should seats survive a suspension until period end?** |
| ◐ **E30** | **Notifications deliver in-app only** | Every SMS and email | Day 19 built fan-out, delivery, preferences, suppression and nudges, and records every message it did not send with the reason. **Two of the three gaps closed 2026-09-22.** **(1) Orphaned PENDING rows** are swept hourly (`notifications.send_orphaned`). A worker that dies between the decision transaction and the send leaves committed PENDING rows nobody owns; an event-sourced message gets another chance on redelivery, **a nudge never does** -- its sequence number is already claimed -- so those rows sat for ever with no error anywhere. The sweep re-resolves the contact rather than reading it back, because contacts are deliberately never stored. **(2) Unsubscribe**: RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` on nudge email, and an unauthenticated one-click `POST /notifications/unsubscribe`. Headers rather than a body link because the body is a translated template; POST rather than GET because mail clients prefetch links and a GET would unsubscribe people who never clicked. The token turns nudges *off* and can do nothing else. **Still owed: bounce and complaint feedback into the suppression list.** `BOUNCED` and `COMPLAINED` exist as reasons and nothing writes them. The safe transport is SES → SNS → SQS (IAM-authenticated) rather than a public webhook needing SNS signature verification, and it cannot be exercised at all until SES leaves the sandbox with a real domain (**E38**) -- so it belongs with that, not before it. Also owed: translations for the newer keys (**C5**), and respecting an existing account's preferences when a college invitation reaches its contact.
| ✅ **E32** | ~~An erasure does not delete the Cognito user~~ | Re-registration after erasure | **Closed 2026-09-22.** `AccountDirectory.delete_user` (`AdminDeleteUser`, idempotent on `UserNotFoundException`) plus the IAM grant. **Called before the database cascade, and the order is the design**: `erase_candidate` replaces `cognito_sub` with its SHA-256, so after it runs there is no identifier left to delete by -- only a hash that addresses nothing in the pool. Every pre-cascade step is therefore retryable, and a Cognito outage releases the request back to RECEIVED with the person's data intact and still erasable, rather than destroying it and leaving a sign-in nothing can name. An account nobody ever signed in to has no Cognito user and none is asked for. 4 tests in `test_privacy_requests.py`.
| **E33** | **A business account cannot erase itself** | Employer and college staff DSRs | `POST /privacy/requests/deletion` refuses a BUSINESS-pool account with `dsr_deletion_requires_support`, and `erase_candidate` refuses one in the database. Deliberate: erasing the last owner of an employer strands the tenant, its jobs, its subscription and its staff, and nobody has decided what should happen to the organisation. Export works for them today. **Client and counsel: what happens to an organisation when its last owner asks to be erased?** |
| ✅ **E34** | ~~Export archives have no S3 lifecycle rule~~ | DPDP, S3 cost | **Closed 2026-09-22.** `aws_s3_bucket_lifecycle_configuration.exports` expires objects after 7 days and non-current versions after 1 (versioning is on for every bucket, so without the second line the archive is still one API call away). The rule is the **backstop**, not the promise: `privacy.expire_exports` still deletes at 48h and clears the pointer on the request row, which a bucket rule cannot do. 7 days is deliberately longer than 48h so the rule never races the sweep. The sweep is now scheduled too (E4). |
| ◐ **E35** | **A roster contact given by phone alone hears nothing** | College invitations while SMS is deferred | **The college is now told, before they commit** (2026-09-22). The roster preview reports `unreachable_rows`: valid rows no invitation can be delivered to. Previously such a row was committed, invited, recorded SKIPPED `NO_CONTACT`, and the college had no way of knowing a third of their students would hear nothing. **The count is derived, not hardcoded** -- `notifications.domain.roster_invitation_contact_fields()` reads `plan_for` and DLT readiness, so when SMS returns it answers `{email, phone}` on its own and the warning disappears without anyone remembering to remove it. Recomputed on every read, because which channels work is a fact about the deployment, not about the file. **Still owed by the client**: whether email should be *required* at import. That refuses data a college has, so it is their call, not ours.
| **E36** | **The discount-code policy is ours** | Launch of discount codes | Built 2026-09-18 with a placeholder policy (`billing.domain.DISCOUNT_POLICY_VERSION`, asserted by a test): no 100% code (a zero payment has no gateway callback, and only a verified callback grants), first checkout only (a UPI auto-renewal is full price), one use per person or organisation. **Client: the three answers.** A 100% code needs a new grant path that no gateway verified, which would be the first; renewals need the mandate amount to change. |
| ✅ **E37** | ~~Business accounts must set up an authenticator app~~ | Business onboarding | **Closed 2026-10-07: optional, off by default (client).** Business pool `mfa_configuration = "OPTIONAL"`, software token only; each user turns it on or off in their settings, against Cognito directly. Terraform only -- the API never checks MFA. Users enrolled while it was mandatory keep it until they turn it off. A user who loses their device is reset by staff with `admin-set-user-mfa-preference` (no console route). |
| ◐ **E38** | **No sending domain yet** | Every email: sign-up codes at volume, invitations, notifications | **A stop-gap exists 2026-09-22:** `-var email_sender_address=ops@…` creates an SES **single-address identity**, verified by a link SES emails to that mailbox, and both Cognito pools and the backend send from it. Good enough for staff, an admin account and a test environment. **Two catches, and the second is the real one.** An address identity carries no DKIM, so SPF cannot align and deliverability is materially worse. And the account is in the **SES sandbox**, where you may send only *to* verified addresses -- so no real candidate receives anything until **production access** is granted (support request, 3-7 days, reviewed by hand). Still owed by the client: **the domain and its DNS** (five records from `terraform output email_dns_records`). |
| ✅ **E31** | ~~Incomplete-profile nudges run on our numbers, unscheduled~~ | R9 | **Closed 2026-09-22, and narrower than it read.** The sweep is scheduled (Celery Beat, E4) and the numbers are now explicit rows (`scripts/seed_config.py`) rather than invisible code defaults. The remaining clause -- "the SMS is SERVICE_EXPLICIT and needs recorded DND consent, so the sign-up screen must collect it" -- **is moot**: `NUDGE_TEMPLATES` is IN_APP and EMAIL only and `test_nothing_is_sent_by_sms` holds it that way, so no nudge goes near a DND number. It becomes live again the day SMS returns, together with D1. The *values* are still ours and still the client's to confirm.
| **E42** | **The API has two error shapes** | The four client teams | Found by the fuzzer 2026-09-22. An `AppError` is answered as RFC 9457 **problem+json** with a stable `code`; an unparseable body never reaches a handler, so Starlette answers it with its own `{"detail": ...}` as plain `application/json` -- the same shape FastAPI uses for 422. So a client must parse two formats and cannot rely on `code` for all of them. `openapi.json` now documents both accurately (`ProblemDetail` and `FrameworkError`) rather than pretending they are one. **Normalising them is the right fix and is a breaking change** for anyone already parsing `detail` -- the frontend team are mid-integration -- so it is a decision, not a tidy-up. |
| **E43** | **The fuzzer's remaining findings are untriaged** | Nothing yet | `tests/integration/test_api_fuzz.py` runs 157 operations against hostile input and is marked `contract` (`pytest -m contract`). It has already paid for itself: every operation documented only its success code and 422 (no 401/403/404/409/429, all of which the API returns constantly), the two error shapes above, and a **500 on a pasted CV containing a NUL byte** -- Postgres cannot store `\x00`, and it died in the asyncpg driver on input any candidate can send. That one is fixed with a regression test. **The rest of the run is not yet triaged and the suite is not green on it**, so it is excluded from the default CI job rather than reported as passing. A full run takes about 15 minutes (157 operations x 8 examples x a real ASGI and database round trip). |
| **E39** | **Six languages, and we wrote all of them** | LAUNCH | The client named six on 2026-09-22 and Punjabi had no bundle at all — it was not even in `SUPPORTED_LOCALES`, so asking for it returned `{}` and every string fell back to English while the picker said the app spoke it. All 159 keys are now translated into hi, bn, kn, mr and pa (`PRIORITY_LOCALES`), with key parity and placeholder parity held by `tests/unit/test_locales.py`. **They were written by us, not by native speakers**, and every bundle says so in `_meta`. This product asks people for money and their CV in the language they chose, so shipping unchecked translation to this audience is the thing that makes it look untrustworthy. **Owed: a speaker of each to read their file.** Also owed: the interview evaluator tested on real recordings in each of the six (E24). |
| **E40** | **The AWS deployment is a test environment, not production** | LAUNCH | One EC2 host running API, worker, beat, Postgres and Redis in docker compose — chosen deliberately on 2026-09-22 for cost (~$20-25/month against ~$90-140). **There are no database backups**: Postgres is a container on an EBS volume, and `pg_dump` is manual (`aws-deployment.md` §5.4). Also no HA, no zero-downtime deploy, TLS terminating on the box, and secrets in a file. **Do not put data here you would mind losing.** The migration to ECS Fargate + ALB + RDS + ElastiCache is written up as §7 of that document, and most of it is not rework: the Dockerfile, the IAM policy document, the beat schedule and every setting carry over. **2026-10-01, partly closed: Postgres is on RDS** (daily snapshot, point-in-time restore, private, TLS verified) in the new account -- step 1 of §7. Backup retention is 1 day until the account leaves the Free plan (E45). Still one host for everything else. |
| **E41** | **Cognito user pools cannot move between AWS accounts** | Changing AWS account | The current account is for testing and will be replaced. Everything else migrates cleanly — every resource is Terraform, nothing hardcodes an account id, bucket names are computed. **Cognito does not**: a new account means new pool ids and **every user signs up again**, because no export preserves passwords. Our `users.cognito_sub` values would also need re-linking by email. **Move before real users exist**, or plan a migration where everyone resets their password. `aws-deployment.md` §6. |
| **E44** | **The SQS broker has never worked outside a laptop** | Moving to ECS (§7 of `aws-deployment.md`) | Found 2026-10-01 on the first real deploy: the worker died at boot with `AccessDenied` on `sqs:ListQueues`. Nothing reads `SQS_QUEUE_URL`, so kombu looks for a queue named `celery` (ListQueues, then CreateQueue) instead of the `bharatpath-tasks-dev` queue Terraform makes, and the app policy rightly grants neither. **The host now uses Redis as the broker** (`CELERY_BROKER_URL=redis://redis:6379/1`); the outbox is the record either way. Fixing SQS is `broker_transport_options.predefined_queues` naming the queue URL, plus `worker_enable_remote_control=False` (SQS cannot carry pidbox queues) -- needed before workers run on Fargate, where there is no host Redis. |
| **E45** | **The AWS account is on the Free plan, which closes the account** | Anyone relying on the API after the credits | Account `335345888157` (2026-10-01) runs on $100 of Free-plan credit at about $43/month. **The account closes when the credit runs out or on 2027-04-01**; resources stop and are deleted 90 days later. Upgrade to the Paid plan first (unused credit carries over). Meanwhile the plan caps RDS backup retention at **1 day** and blocks Textract (E2). Budget alerts at $15/$30/$45 gross go to the account owner. |

---

## What is *not* blocked

Worth stating, because it is most of the build:

- Days 7, 9–14, 16–20 can all be built against placeholder content and seeded
  config. Only **Days 8 and 15** have hard content dependencies.
- `openapi.json` publishes on every green build, so the **mobile and three web
  teams are not blocked** — they generate clients against real endpoints today.
- Email/password authentication works on both Cognito pools **now**, and it is
  the only sign-in the client wants (2026-09-18).

---

## The three to move this week

1. **D2 — Twilio.** Days, not weeks, and it unblocks phone OTP plus the three
   Lambda triggers. The cheapest large unblock available.
2. **B6 and B8 — the two rescissions never asked for.** Both are one sentence
   from the client and both are gaps in our own process, not theirs.
3. **A2 — book the calibration session.** One working session, and Day 8 is
   flagged as uncompressible in the plan.

**Two more that are now cheap, because the work either side of them is done:**

4. **Take the SMS drafts to the DLT portal.** 19 bodies are written
   (`sms_templates()`). Registration is 2–4 weeks and it has not started on the
   template side, only the entity side. Nothing else about it gets faster later.
5. ~~**C12 — does a college seat cover the student's own subscription?**~~
   ✅ **Answered 2026-09-12: it does.** The one open item that changed a
   revenue number rather than a date, and it changed it by 2.7x. Three
   follow-on questions replace it, none blocking the build — see
   `answers-log.md` Round 8.
