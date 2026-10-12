# BharatPath — Questions and Answers Log

> **The complete record.** Every question put to the client, their answer verbatim, the date, and
> what we did about it. Nothing is summarised away — where an answer was ambiguous or was later
> contradicted, both versions are here.
>
> **Still-open questions live in [`questions.txt`](questions.txt)**, written in plain language and
> ready to send. This file is the archive; that file is the ask.
>
> Last updated 10 October 2026 — Round 14 added (KYB send back, correct and resubmit).

---

## Status at a glance

| Round | Source | Asked | Answered | Still open |
|---

## Round 14 — client request, 2026-10-10

Relayed by the backend lead, with a screenshot of the console's KYB queue.

| # | Request (verbatim) | What we did |
|---|---|---|
| **14.1** | *"approve reject ....in case of reject with remark needs to repload manula entry update and document update again submit admin mai submit ka notification and if reject correct then notification to employer/college"* | **Employers only**: colleges have no review, by design (`college/models.py`), and the lead confirmed nothing changes for them. Agreed with the lead: **Send back** (`MORE_INFO_REQUIRED`) reopens the same submission to correct and resubmit; **Reject** is final, and the next submission starts filled in from it. Both carry a reason and optional per-field / per-document flags. Every decision recorded with what it was made on, so a resubmission shows what changed. Staff (admins, KYB reviewers) told **in-app** of every submission; owners told of every decision, in-app and email, reason included (a rejection used to tell nobody). Reviewers can now open the uploaded files. Migration `0016_kyb_review_flow`. |

---

## Round 13 — client decisions, 2026-10-09

Relayed by the backend lead from the client, 8:36 pm (WhatsApp).

| # | Question | Client answer (verbatim) | What we did |
|---|---|---|---|
| **13.1** | R15's switch (`kyb.require_approval`) could be changed only by writing a config row by hand. Should staff change it? | *"it should have option for changing from the UI for manual and auto approval of KYB"* | **`GET`/`PUT /admin/settings/kyb-approval`.** Admin only to flip it (`kyb_policy`); reviewers can read it. Each flip is a new config version and an audit row. **Our call, not asked:** switching to automatic approves nobody already waiting, because that would be a verification decision nobody made about those employers. The console page already existed in `frontend/` and was calling this route. |
| **13.2** | E36 Q1: can a discount code be 100%? | *"keep range of discount till 100"* | **Percentages are 1–100**, and a fixed amount may make the price exactly zero. A zero checkout settles immediately as a `complimentary` payment with no gateway (migration `0014_complimentary_discounts`). **Unchanged, still ours (E36 Q2, Q3):** a free code is first checkout only and one use per person or organisation, and still counts against its usage limit. |

---

## Round 12 — client decision, 2026-09-30

Relayed by the backend lead from Rishabh (client side), 9:47 am, after a college
dashboard showed "—" for a month with one hire.

| # | Question | Client answer (verbatim) | What we did |
|---|---|---|---|
| **12.1** | College analytics withhold a band or month under 5 (and a partner), so September's single hire showed as "—". Keep it? | *"Show exact number and analytics. That is what the college is paying for on behalf of the students, because if the colleges does not see the incentive for paying on behalf of the student, they might avoid it. So that's why providing accurate analytics is important."* | **Exact above the cohort floor.** `min_cell_size` defaults to 1 (withholds nothing); `0008_exact_college_analytics` inserts config version 2 on existing databases. **Kept:** the cohort floor (10 connected students; the code refuses below 5) and the median rounded to 10 — neither was asked about. A row can raise `min_cell_size` again. |
| **12.2** | The ROSTER consent words promise "totals and statistics that never name you"; an exact small cell beside the college's own roster can point at one student (E28). | *Accepted* (relayed by the backend lead, same day) | Recorded. The consent text is unchanged; **E28 accepted by the client**, counsel not yet asked. |

---

## Round 11 — client requests, 2026-09-29

A feature request for the four portals, relayed by the backend developer, with
four follow-up decisions taken the same day. Recorded here because several
reverse earlier positions.

| # | Request or question | Answer | What we did |
|---|---|---|---|
| **11.1** | Admin: a student's full page — onboarding details, CV, a timeline of every score change, interviews with their recordings, course status, applications with stages and analytics. | Requested | **Built** (`/admin/candidates/{id}/…`). Reverses "a drill-down never shows a CV or a whole contact": each larger reveal is its own endpoint, capability and audit row. Score timeline shows display values only. |
| **11.2** | College: onboarding details, CV, current score, interviews given, course % complete, applications with stage and analytics. | Requested | **Built** under a **new INDIVIDUAL consent version** (`placeholder-2-2026-09-29`) whose words name every field. Students on version 1 keep version 1's view until they agree again. |
| **11.3** | Employer: a message box per candidate to invite to an interview or OA, sent by email and notification. | Requested; *applicants only* | **Built** (`/employer/applications/{id}/messages`). Never to a search result. |
| **11.4** | Student: a locked course tab until paid; lessons as YouTube (unlisted) embeds or AWS uploads. | Requested | **Built.** Unlisted YouTube is not behind the paywall — anyone with the link can watch; uploads are. |
| **11.5** | What counts as completing the course (C1)? | *All lessons watched* | **C1 closed.** Rule `lessons-watched-1-2026-09-29`: every published lesson reached to 90% with half its length elapsed. |
| **11.6** | Interview questions from onboarding answers + CV, via an LLM; follow-ups; never repeat an earlier session's questions; six per session, a constant. | Requested; *adaptive per answer* | **Built** (`interview/questions.py`, OpenAI). Each answer is transcribed in-session so the next question can follow it. A refused repeat goes back to the model with the reason. |
| **11.7** | A history of interviews the student can go through, with recordings. | Requested | **Built** (`/candidate/interview/history`, `…/recordings`). |
| **11.8** | Should fixed questions remain as a fallback? | *"I want to set interviews questions by default by only ai and not fixed questions. i want it dynamic"* | **AI only.** OpenAI is the default writer; no fixed-question fallback (a question that cannot be written is a 503 the app retries); the API needs `OPENAI_API_KEY` to boot. |

---

## Round 10 — client answers, 2026-09-15

Answers to the pending list sent after Day 14. Short answers; where "correct"
confirmed a statement rather than choosing an option, that is recorded as such.

| # | Question | Client answer (verbatim) | What we did |
|---|---|---|---|
| **10.1** | N4: acknowledge in writing that anyone who pays can open every candidate's contact details, with KYB unverified. | *"N4 acknowledged"* | **B7 closed.** Day 14's caps, alerts and no-export rule stay as mitigation. |
| **10.2** | B3: personal data fully deleted, payment and audit records kept as the law requires; counsel to set the period. | *"B3 correct"* | Carve-out confirmed. **The retention period is still owed.** |
| **10.3** | D4: counsel has not started the scoring-model review. | *"D4 correct"* | Still open. |
| **10.4** | C11: duplicate CV detection is dropped. | *"C11 correct"* | **C11 closed** — no duplicate detection. |
| **10.5** | E13: should candidates enter their name at sign-up? | *"yes"* | **Built**: `PUT /candidate/profile/name`, shown on the reveal only. |
| **10.6** | Abuse-limit defaults: 60 profiles/hour and 300/day per employer, 20 opens/minute per person, alert at 40 in 10 minutes. | *"correct deafult"* | Accepted as the client's defaults; still one `config_values` row. |
| **10.7** | E7: employers cannot sign themselves up yet; opening it is one setting, and admits anyone who pays. | *"correct"* | **Unchanged.** "Correct" confirms the current state; whether to open it is **asked again**. |
| **10.8** | E11: limit interview links to Meet, Zoom, Teams and Webex? | *"dont limit"* | **E11 closed**, no allowlist. |
| **10.9** | C13: applications expire after 30 days of employer silence. | *"correct"* | **C13 closed** — 30 days is the client's number. |
| **10.10** | E3: support legacy `.doc`, or stop accepting it? | *"stop accepting them"* | **E3 closed** — refused at upload. |

Not answered this round: the three college-seat follow-ons (Round 8), and the
external items (payment gateway, AWS activation, Twilio, platform staff tenant).

---

## Round 9 — client answer, 2026-09-12

| # | Question | Client answer (verbatim) | What we did |
|---|---|---|---|
| **9.1** | Do these 35 scored profiles match your judgment? Mark each too low / about right / too high. | *"the scores are perfect fine"* | **A2 / N3 closed.** All 35 accepted with no adjustment. The rubric moves from *internally consistent* to *agreed*; no band table changed, so no score moved and the golden corpus did not need regenerating. |

### Why this mattered more than its length

The rubric was calibrated by us from general industry practice, because the
client declined to supply real CVs (Round 7.1). That proved it was internally
consistent — quality beats tenure, keyword stuffing loses, no sector bias —
but **not** that it matched their commercial judgment. If their idea of
"strong" had sat higher or lower than ours, every score would have been wrong
in the same direction and nothing in CI could have detected it, because CI
only knows what we told it.

Thirty-five profiles were put to them with the live engine's scores against
each. The answer was that all of them are right. That is the strongest form
the answer could take, and it is what unblocked the rest of Day 8.

**What this does and does not settle.** It settles the shape of the rubric
against the client's judgment. It does not make the corpus real: the profiles
are still synthetic, and a systematic difference between synthetic profiles
and the CVs that actually arrive would still be invisible. Worth re-running
against thirty real CVs once there are thirty real CVs.

---

## Round 8 — client answer, 2026-09-12

One question, and it was the only open item that moved a revenue number rather
than a date.

| # | Question | Client answer (verbatim) | What we did |
|---|---|---|---|
| **8.1** | When a college buys seats for its students, does the student still pay their own subscription? | *"No - Student does not pay if the college has paid for it."* | **C12 closed.** A seat covers the student entirely. The college price list was rebuilt on that basis (~2.7x), and the entitlement rule for Day 15/17 is now settled: access is a personal subscription **OR** an active college seat. |

### Why this one mattered more than its length

C12 had **never been put to the client**. Both price lists were built on the
unexamined assumption that a seat and a subscription were separate purchases —
that a college deal earned the seat fee *on top of* whatever those students
paid us directly. On that reading, ~₹12–17 per seat per month was a placement
-cell tool sold alongside real candidate revenue, and it looked reasonable.

The answer is the opposite one. The seat fee is the **entire** lifetime revenue
from that student, which made the old ladder indefensible:

| Plan | Old total | Old per seat / period, ex-tax | Direct candidate, ex-tax | Old yield |
|---|---|---|---|---|
| `COLLEGE_SEMESTER_250` | ₹24,999 | ₹99.99 | ₹592.37 | **17%** |
| `COLLEGE_SEMESTER_1000` | ₹79,999 | ₹79.99 | ₹592.37 | **13%** |
| `COLLEGE_ANNUAL_250` | ₹44,999 | ₹179.99 | ₹1,016.10 | **18%** |
| `COLLEGE_ANNUAL_1000` | ₹1,39,999 | ₹139.99 | ₹1,016.10 | **14%** |

A thousand-seat annual deal would have displaced roughly **₹10.2 lakh** of
candidate revenue to book **₹1.4 lakh**. Every college signed would have made
the business smaller, and the figure that reveals it — revenue per seat — was
not computed anywhere in the codebase.

### What replaced it

A seat is now priced as what it actually is: **a bulk-rate candidate
subscription**, discounted for volume rather than invented independently. The
discount is genuine — one invoice, paid upfront, students delivered at zero
acquisition cost, onboarding carried by the college — but it is a discount on
a known number.

| Plan | New total | Per seat, ex-tax | Yield vs direct |
|---|---|---|---|
| `COLLEGE_SEMESTER_250` | ₹69,999 | ₹279.99 | 47.3% |
| `COLLEGE_SEMESTER_1000` | ₹2,19,999 | ₹219.99 | 37.1% |
| `COLLEGE_ANNUAL_250` | ₹1,19,999 | ₹479.99 | 47.2% |
| `COLLEGE_ANNUAL_1000` | ₹3,79,999 | ₹379.99 | 37.4% |

**Ex-tax on both sides.** Candidate prices are quoted tax-inclusive and
business prices exclusive, so comparing the raw numbers flatters a seat by 18%
— the same class of error in miniature, and the reason `GST_RATE` is now a
constant in the catalogue rather than something applied only at the invoice.

`MIN_SEAT_SHARE_OF_DIRECT = 0.35` and
`test_a_seat_never_undercuts_direct_candidate_revenue` hold the floor, so this
cannot drift back by increments. **The old list sat at ~0.13 and nothing
failed** — every existing price check was structural (totals ascending, periods
consistent, tax flags correct), and a number can satisfy all of that while
being an order of magnitude wrong about what it is selling.

**Still placeholder.** `PLACEHOLDER_PRICING` is still `True`. These numbers
still need sign-off — but they are now wrong in a direction that costs a deal
rather than one that costs the business.

### Three things this answer opens, which have not been asked

Consequences of 8.1, not restatements of it. None blocks the build; all three
need an answer before the first college contract.

1. **A student who has already paid, then joins a college roster.** Refund,
   credit, or does their own subscription simply run alongside the seat? We are
   building the third — no money moves without a human deciding it — but a
   student who paid ₹1,199 in June and is seated for free in July will ask.
2. **What happens when the college does not renew.** The student loses access
   unless they buy their own. That is a churn cliff arriving in batches of 250
   or 1000 on a date we know in advance, and it is also a support load. Worth a
   deliberate grace period rather than a hard cutoff discovered live.
3. **Whether a seat covers the paid add-ons.** The course (+30) and interview
   sessions (+60) are one-off purchases, not subscription features. Our
   assumption is that a seat covers the **subscription only** and add-ons stay
   the student's own purchase — otherwise a 1000-seat deal silently includes
   ₹8.5 lakh of add-on inventory. Flagged rather than assumed.

---

## Round 7 — client answers, 2026-09-11

The largest single unblocking round of the project. Ten decisions, eight of
which had been open since August.

| # | Question | Client answer (verbatim) | What we did |
|---|---|---|---|
| **7.1** | How is the score calculated — dimensions and weights? | *"choose best from your side how score should be calculated - use your best knowledge - unblocked"* | Delegated to us. Rubric defined in `scoring-approach.md` §4a and implemented in `scoring/domain.py`. **The arithmetic was already fixed and approved (700 + 200 + 30 + 60 = 990); only the 0–200 resume band was open.** |
| **7.2** | May CV text leave India? | *"can be"* | **N2 closed.** Removes the constraint on model hosting and region. We are keeping processing in `ap-south-1` anyway — it costs nothing and is the answer that stays right if the position changes. |
| **7.3** | Is the score ever explained to the candidate? | *"confirmed"* — never shown | **Q12 closed.** Breakdown is still computed and stored for admin drill-down and disputes; no candidate-facing schema exposes it. |
| **7.4** | On account deletion, what is retained? | *"do full delete for them"* | **Q13 answered in principle, with a carve-out we are flagging.** Personal data is hard-deleted. Financial and audit rows cannot be — see the note below. |
| **7.5** | Employer type and industry lists | *"explain what do you mean"* | Explained, and a proposed list supplied for confirmation. |
| **7.6** | Rules for detecting dishonest CVs | *"use your best knowledge"* | Delegated to us. **Delivered 2026-09-12** — 8 rules in `integrity/domain.py`, 40 tests. See 7.6 below. |
| **7.7** | College seat model — one payment covers up to N students? | *"yes"* | **Q10 closed.** Mirrors the employer model. |
| **7.8** | Is "pay monthly, see everyone" correct, replacing per-candidate unlock? | *"that is correct"* | **N5 closed.** The rescission we had never asked for. Five stale acceptance criteria in SRS §2.25.2 are now formally superseded. |
| **7.9** | Referral code typed by the student, rather than invite-and-accept? | *"do it"* | **N6 closed.** |
| **7.10** | Course content, prices, question banks, translations, SMS copy, branding, form fields | *"create best for now according to your knowledge"* | Placeholder content to be produced by us, clearly marked as placeholder and replaceable without code changes. **Delivered 2026-09-12.** See 7.10 below. |

**Also reported:** Twilio account started; TRAI DLT started. **Apple Developer
declared not needed** — recorded as a scope decision, see below.

### 7.4 — the one carve-out on "full delete"

We are implementing full deletion of personal data. Two categories cannot be
deleted with it, and this is a legal constraint rather than a technical one:

- **Financial records** — subscription and course purchase rows. Indian
  statutory retention applies to financial records regardless of a deletion
  request; the right to erasure does not override it.
- **Audit rows** — PRD §3.9 requires an immutable audit trail, and invariant 7′
  requires every PII reveal to be audited. Deleting those rows destroys the
  evidence that a reveal was lawful, which harms the candidate's position as
  much as ours.

**What we are building:** every field that identifies a person is hard-deleted
(name, phone, email, CV files, parsed text, scores). Financial and audit rows
survive with the person replaced by a non-reversible pseudonymous id, so they
record *that* a transaction happened without recording *who*. From the
candidate's point of view they are gone.

**This needs a lawyer's sign-off, not ours.** It is the standard
reconciliation, but retention periods are a legal question.

### Apple Developer — scope consequence

Declared not needed (2026-09-11). Recorded because it is reversible only at a
cost: the account needs a D-U-N-S number and takes 1–3 weeks. **If iOS is
wanted later, that is a 1–3 week lead time before a build can ship**, not a
sprint decision. Android and the web consoles are unaffected.

### 7.6 — what we built with "use your best knowledge" *(delivered 2026-09-12)*

Eight rules in `integrity/domain.py`. **The part to review is not the list of
rules, it is the severity policy**, because severity is what decides whether a
real person disappears from employer search before anyone has looked at them.

| Severity | Consequence | Rules |
|---|---|---|
| **HIGH** | Hidden from employer search until a human clears it (PRD 7.2) | Instructions aimed at an automated reader; text hidden from a human one |
| **MEDIUM** | Reviewer queue. Candidate stays visible | Future-dated employment; overlapping full-time roles; claimed experience far exceeding the dates; a platform score written into the CV |
| **LOW** | A note for a reviewer already looking | Senior title with little tenure; a long unevidenced skills list |

Only two rules may ever reach HIGH, and a test enforces that. Both are things
nobody does by accident — a mistyped year is not in that category, and neither
is an unusual career.

**Four rules we chose not to write**, each because it would hit honest
candidates far more often than dishonest ones:

- **Employment gaps.** They fall on women after childbirth, on carers and on
  people with health conditions.
- **Work predating a qualification.** Common in India, and it only works as a
  signal by reasoning about the candidate's age — which invariant 5 forbids.
- **Duplicate or templated CVs across candidates.** Dropped by the client
  already (R6). Shared wording is what a CV-writing service produces, and
  paying for help writing your CV is not dishonesty.
- **Unverifiable claims generally.** Almost every line of a CV is unverifiable;
  a rule that fires on all of them is a rule nobody reads.

**Integrity never touches the score** (SRS 1.4.5), now enforced by an
import-linter contract. A dishonest CV is handled by a person looking at it,
not by a silent deduction a candidate can neither see nor appeal.

### 7.10 — the placeholder content *(delivered 2026-09-12)*

All of it, marked as ours rather than the client's by a flag that a test
asserts — so "this is still a placeholder" survives a demo instead of living in
a comment. Full table in [`blockers.md`](blockers.md) category C; the summary:

| Item | Built | Flag |
|---|---|---|
| Prices | 11 plans, 2 one-off products | `PLACEHOLDER_PRICING` |
| Course | 6 modules, 18 lessons, ~2h20 | `HAS_MEDIA = False` |
| Questionnaire | 12 questions | `BANK_VERSION` |
| Interview | 3 × 6 questions, 5-dimension rubric | `BANK_VERSION` |
| Messages | 21 templates, 17 SMS | `dlt_template_id is None` |
| Translations | 8 locales × 32 keys | native review owed |
| Forms | KYB 27 fields, college 20 | `FORM_VERSION` |
| Design | System, tokens, accessibility | no logo — **C7 stays open** |

**Three things in there are decisions, not drafts, and are worth a reply:**

1. **The score may never be drawn as a red-to-green gauge.** That picture is
   the visual language of an Indian bureau score. Invariant 6 forbids the
   *words* because the resemblance is a legal risk; a dial makes the
   resemblance stronger than any word could.
2. **We excluded marital status, gender, religion, caste and photograph** from
   every form and the questionnaire. These are ordinary on Indian application
   forms and are discrimination vectors. Adding any back is a decision for the
   client and their counsel, in writing.
3. **The mock interview never assesses accent, fluency, pace or pitch.** In
   this market those measure schooling and region, not ability — and this is an
   audio product used in eight languages.

**One question this work surfaced that has never been asked** — `blockers.md`
C12: **when a college buys seats, does the student still pay their own
subscription?** Both price lists assume yes. If the answer is no, the college
prices are far too low and the candidate revenue from those students is zero.
It is one sentence now and an argument after the first college deal.

---|---|---|---|---|
| 0 | Build brief open questions | 8 | 6 | 2 |
| 1 | Document comments, 24 Aug | 9 | 9 | 0 |
| 2 | Client note, 27 Aug | 6 | 6 | 0 |
| 3 | Our questions Q1–Q5, answered 27 Aug eve | 5 | 5 | 0 |
| 4 | Our questions Q6–Q13, answered 27 Aug late | 8 | 6 | 2 partial |
| 5 | Raised by us after their answers | 4 | 0 | 4 |
| 6 | **Raised by us on review, 30 Aug** | **4** | **0** | **4** |
| 6a | **Client answer, 30 Aug** | — | **1** | — |
| | **Total** | **44** | **33** | **11** |

**Nothing is blocking Day 1.** ✅ **`scoring-approach.md` was approved on 30 August (Round 6a).**
Two Day 8 blockers remain and neither is engineering: the **data-residency decision** (counsel) and
the **50–100 CV calibration corpus** (a working session). One item needs a written answer before
Day 14, and the deletion policy has a legal review cycle attached and needs starting now.

**New on 30 August.** A review of this log against the PRD and SRS found **three questions that
had never been put to the client at all** — course content, the unlock rescission, and prices —
plus one wording confirmation. They are Round 6. **6.1 (course content) is the one with a lead
time we do not control**, and 6.2 is a gap in our own process: we chased a one-sentence rescission
twice while the largest reversal in the project went unrecorded.

---

## Round 0 — Open questions from the original build brief

Raised by us in `BharatPath_Build_Brief.docx` before any client contact.

### 0.1 Audio-only or video? · was a BLOCKER

**Asked:** The PRD says candidates record responses as "audio/video" and lists camera and lighting
in the device check. The SRS says in bold these are "phone-based audio interviews only… There is
no camera, video capture, or video-based interview experience."

**Answer — client, 2026-08-24:** Audio only. No video.

**What we did:** Device check drops camera and lighting. No camera permission. Opus/AAC mono at
16 kHz, ~20 KB per 30-second answer, which is what makes progressive upload viable on 2G. Storage
and evaluation costs fall by roughly an order of magnitude.
→ `plan.md` §3, §6, §11, Day 16.

> The SRS's own device-check table still lists "Lighting". That row is dead — flag it to whoever
> maintains the SRS.

---

### 0.2 "Phone-based" — a real call, or in-app recording? · was a BLOCKER

**Asked:** SRS §1.10.4 describes the system asking questions live and the candidate answering
"over the phone", which reads as a real PSTN call. But §1.10.5 describes local storage, per-question
upload, a retry queue and offline recovery — which only makes sense for in-app recording. These are
different builds, four to six weeks apart in estimate.

**Answer — client, 2026-08-24:** In-app recording.

> *"Recorded, not real time conversation."* — comment on open question 2

**What we did:** No telephony vendor, no Amazon Connect, no Exotel, no real-time streaming
speech-to-text, no voice DLT. Removed the largest single unknown from the estimate.
→ `plan.md` §13 Q1, Day 16.

**Re-confirmed** in the 24 August document comments, so this can be treated as settled.

---

### 0.3 After unlock, does the employer see the real score or the floored one? · was a BLOCKER

**Asked:** Rule 2 floors displayed scores at 680. Rule 6 says unlock reveals "the exact score". So
a candidate with a true score of 540 sees 680 while a paying employer sees 540 — a trust problem
and arguably a disclosure one. Neither document resolved it.

**Answer — client, 2026-08-24:**

> *"No real score ever"* — comment on open question 3

**What we did:** "Exact score" means the exact *displayed* score. The raw value is still computed
and stored for reproducibility, never serialized to anyone. Invariant 7 strengthened with a schema
test asserting no employer-facing response model has a `raw_value` field.
→ `plan.md` invariant 7, Days 10 and 14.

**Superseded in effect by Round 3.** Once the base became 700 and everyone receives it, no score
can fall below 700 — so stored and displayed values are now always identical and there is no
hidden number left to protect. The invariant stays anyway.

---

### 0.4 Job thresholds versus the display floor

**Asked:** Eligibility is computed against the authoritative score while the candidate sees the
floored one. A candidate seeing "680" who is told they fail a 680-threshold job will read it as a
bug. What does the candidate-facing copy say?

**Answer:** Not answered directly — resolved by the arithmetic in Round 3.

**What we did:** With 700 as a base rather than a floor, the two values are the same and the
contradiction disappears. One residual: a threshold below the floor is meaningless, so threshold
input is constrained to ≥ the configured floor.
→ `plan.md` Days 10 and 14.

**Related item still open:** the candidate-facing copy when they miss a threshold — see Round 5.4,
because "what would need to improve" is an explanation and the score is no longer explained.

---

### 0.5 Data deletion conflicts with audit immutability · STILL OPEN

**Asked:** Deletion on request is required. An immutable audit trail is required. Financial records
carry statutory retention. These pull against each other and the resolution is a policy decision,
not an engineering one.

**Answer — client, 2026-08-27:** *"For data deletion policy we will discuss and let you know on it"*

**Status:** 🔴 **Still open. Needed by Day 20, has a legal review cycle attached.**
We have asked for a *date* rather than the answer, since a date is more useful for planning than
an early arrival. Now slightly larger in scope than when first raised — subscription and course
purchase records are financial records too.
→ `questions.txt` §3F.

---

### 0.6 Two separate consent scopes

**Asked:** Roster-link consent and individual-visibility consent are distinct in the SRS. Confirm
the exact scopes and what each unlocks.

**Answer:** Not answered explicitly, but the client's Round 4 referral-code design assumes the
distinction.

**What we did:** Modelled both from the first migration — `ROSTER` and `INDIVIDUAL`, separate
grants, roster never implying individual visibility. Retrofitting a consent model onto live student
data is painful and legally exposed, so this was never going to wait for confirmation.
→ `plan.md` §6, Day 18.

---

### 0.7 PRD §1.1 says "all five surfaces" but lists four

**Answer:** Not raised with the client. Almost certainly a documentation typo. Worth one line of
confirmation at some point; blocks nothing.

---

### 0.8 Hire-event billing is deferred · STILL OPEN (by the client's choice)

**Asked:** The SRS states billing behaviour for hire events remains a business decision and "must
not be assumed in the UI contract."

**Status:** ⏸️ **Deliberately deferred by the client.** Building the hire-confirmation flow is
fine; the billing hook stays a stub. Not blocking.
→ `plan.md` Day 12.

---

## Round 1 — Document comments, 24 August 2026

Nine comments embedded in `BharatPath_Build_Brief_new.docx`. **The document's body text is
byte-identical to the 24 August version** — every update was comment-borne, which is worth knowing
if anyone goes looking for tracked changes.

### 1.1 Do paid add-ons change the core score?

**Context:** Hard rule 4 — *"Paid add-ons must never change the core score — and this has to be
verifiable, not merely visually true."*

**Answer — French Fry, 2026-08-24:**

> *"It will change it"*

**What we did:** Rule 4 rescinded and replaced by **invariant 4′** — add-on contributions are
typed, versioned and capped. The `import-linter` contract was **inverted, not deleted**: `scoring`
now reads add-on completion events, and the add-on modules still cannot write a score.
`scores` gained `base_value`, `addon_value` and `contributing_events`, without which `replay()`
breaks the first time a candidate buys a course.
→ `plan.md` §1, §2, §6, Days 8 and 16.

---

### 1.2 Is the score explainable?

**Answer — Krish Goyal, 2026-08-24:**

> *"Score is not explainable but is reproducible basis the improvements made by opting for courses
> and add ons to the CV"*

**Conflict:** The 27 August note said the opposite — *"explaination required"*. Resolved in
Round 3.3: the score is never explained.

---

### 1.3 How does unlock work?

**Answer — French Fry, 2026-08-24:** This was a *question*, not an answer:

> *"How will the unlock work, subscription based? allowing 50 unlocks at once under tiers or one
> at a time."*

**Status:** Answered in Round 4.3 — no tiers, no unlocks at all.

---

### 1.4 Can a user get a score without logging in?

**Answer — French Fry, 2026-08-24:**

> *"Without login the user cannot parse the resume/ cannot get a score."*

**What we did:** Deleted the entire anonymous-first flow — `anonymous_subjects`,
`/api/v1/public/session`, the opaque guest token, and the claim transaction. `subject_id`
collapsed to `user_id`. This removed the sprint's highest-design-risk half-day **and** the DPDP
exposure of holding a complete resume for an unauthenticated user.
→ `plan.md` §5.7, §6, Days 4, 5, 6.

**Contradicts SRS §2.25.1** — "Candidate can reach the first score before mandatory account
creation" is a documented acceptance criterion. Written rescission received in Round 4.7.

---

### 1.5 Duplicate resume detection

**Answer — French Fry, 2026-08-24:**

> *"Don't flag for duplicates."*

**What we did:** The duplicate-content-hash rule is not registered. Timeline-inconsistency checking
and the severity/suppression machinery stay, and the rule engine still supports duplicate detection
if it ever comes back.
→ `plan.md` Day 9.

> **Not to be confused with duplicate *application* prevention** — one candidate applying twice to
> the same job. Different mechanism, it is a database constraint, and it stays.

**Status:** ⚠️ Client marked this for re-confirmation in Round 4.7. Treated as provisional.

---

### 1.6 KYB verification provider

**Answer — French Fry, 2026-08-24:**

> *"Manual, uploading will be there but manual"*

**Contradicted three days later** by the 27 August note — *"KYB won't be there, automatic
approval"*. Resolved in Round 4.2.

---

### 1.7 Pricing and revenue model

**Answer — French Fry, 2026-08-24:**

> *"Student -> Subscription (Nothing free (Per month/quarterly/semester/annually)) + Course +
> Audio Mock Interview. Employers -> Flat Fee/Tier. College -> B2B Deal, No of Seats will be
> assigned from the admin. (CRUD Operations and stop operations in backend admin)"*

**What we did:** Replaced the prepaid-wallet model with `plans`, `subscriptions`,
`subscription_events`, `courses`, `course_purchases`, `course_completions`, `college_seats` and
`tenant_suspensions`. Two new modules.
→ `plan.md` §4, §6, Days 15, 17, 19.

**"Nothing free" retires the PRD §2 objective** of a credible score at no cost. Confirmed in
Round 4.1. The employer half — "Flat Fee/Tier" — was superseded in Round 4.3.

---

### 1.8 Real call or recording?

**Answer — French Fry, 2026-08-24:** *"Recorded, not real time conversation."*
Re-confirms Round 0.2. No change.

---

### 1.9 Real score or floored, post-unlock?

**Answer — French Fry, 2026-08-24:** *"No real score ever"*
Answered Round 0.3 above.

---

## Round 2 — Client note, 27 August 2026

Six numbered items received by WhatsApp.

| # | Client's words | What we did |
|---|---|---|
| 1 | *"Scoring - Base -700, max - 990, Course/Videos - Add 30 to the score, Critically judge and give points out of 200 points (990-790), explaination required."* | Scale changed from 680–999 to **700–990**. Both were already versioned config, so this was seed data, not a migration. The arithmetic did not close on first reading — resolved in Round 3.1. |
| 2 | *"Mock Interview - Per Session 20 points increase, up to 60 points."* | Interview contribution capped at +60 in `scoring/domain.py`, enforced by a property test. |
| 3 | *"Only Sign Up is allowed, nothing else, not even the resume upload, paid first audience only. Same for employers."* | Anonymous flow deleted. Extended to a full pay-first model in Round 4.1. |
| 4 | *"Nothing uploaded, then also send notifications for that."* | Scheduled sweep for users with no resume, with a cadence cap and suppression list — nudging the same person daily forever is the failure mode. → Day 19. |
| 5 | *"KYB won't be there, automatic approval"* | Contradicted the 24 August comment. We built the gate anyway with a config switch; confirmed correct in Round 4.2. |
| 6 | *"Employer - MNC, Industry"* | `employer_type` and `industry` on `employers`, enumerated and config-seeded. Values still owed. |

---

## Round 3 — Our Q1–Q5, answered 27 August evening

### 3.1 The score arithmetic · was a BLOCKER

**Asked:** 700 + a 200-point band = 900, not 990. And the band was written as spanning 790–990.
There is a 90-point gap we cannot explain. Please walk us through one worked example.

**Answer — client, 2026-08-27:**

> *"The user has been already given a base score 700, then the user gets an option to purchase a
> course (only 1 course will be available on the platform) so now once the user has purchased the
> course, the score automatically increases … Then if a user gives a mock interview then the score
> increases by 20 points but only for a total of 3 interviews. The user can give N number of
> interviews on the platform, by purchasing, but the max number of score that can be increased via
> interviews are capped at 60 … So now you see the base is 700, the user gets 30 from one time
> course, only 1 course available to purchase and it increases the score only once. Then another 60
> from 3 interviews, that is making it a total of 790. Now the maximum score is capped at 990, and
> no one gets above that, that is a total of 200 points out of which we have to mark our user."*

**The arithmetic closes exactly:**

```
base                                    700
resume judgment      0 – 200      →   700 – 900
course (one, once)        +30      →   730 – 930
interviews (3 × 20)       +60      →   790 – 990
                       ───────
maximum                                 990   = 700 + 200 + 30 + 60, exactly
minimum                                 700
```

**What we did — three consequences, all simplifications:**

- **No clamp needed at the ceiling.** 990 is arithmetic, not a rule. We assert it, but if the
  assertion ever fires it is a bug rather than a business rule.
- **The display floor became unreachable.** 700 is a *base* every score receives, so stored value
  and displayed value are now always the same number. The floor machinery stays because it is
  config-driven and free, but it is a no-op.
- **Round 0.3 is satisfied for free.** No hidden raw score exists to leak.

→ `plan.md` invariants 1, 2, 4′, §5.6, §6, Days 8 and 16.

---

### 3.2 Add-on points — per item or lifetime? / Do they clip at 990?

**Answer — client, 2026-08-27:** One course exists on the platform, purchasable once, +30 total.
Interviews may be bought without limit but contribute +20 each only to a ceiling of +60.

> *"let us say the user has 700 base, and the score of resume is 200/200, then 900 is the maximum
> score the user can get. And he will require to do the purchases to reach 990."*

**What we did:** Caps as pure functions in `scoring/domain.py`, property-tested so no ordering or
quantity of completions can breach them.

**One thing we added that was not asked for:** a candidate can buy a fourth interview session that
earns no points. We will show an explicit confirmation before taking payment — *"this session will
not increase your score."* Without it, that is a refund request and a payment dispute, and disputes
cost more than the sale.
→ `plan.md` Day 16.

---

### 3.3 Is the score explained to the candidate?

**Asked:** The document said "not explainable"; the note said "explaination required". These
cannot both be built.

**Answer — client, 2026-08-27:**

> *"The score is never explained to the user."*

**What we did:** No breakdown screen, no category detail, no improvement suggestions. `suggestions`
dropped from `scores`. The breakdown is **still computed and stored** — admin drill-down and
dispute handling need it — and no candidate-facing schema may expose it, enforced by a schema test.
Invariant 1 is now purely *reproducible*; the "explainable" half is formally dead.
→ `plan.md` invariant 1, §6, Day 8.

**Contradicts PRD §4.2**, which promises a category-by-category breakdown and top improvement
suggestions. Rescission requested and **still outstanding** — see Round 5.4.

---

### 3.4 Is the 200-point band judged by an AI? · was a BLOCKER

**Asked by us. Turned back to us by the client:**

> *"You tell us the approach, we want the score to be reproduceable but by formulating it we cannot
> bound it to only certain industries so AI would be coming into play, tell us your approach for
> this (the word here is reproducible score)"*

**Our answer:** Written up in full as **[`scoring-approach.md`](scoring-approach.md)**. In one line:
**the model never emits a score.** It reads the CV — the part a fixed formula genuinely cannot do
across industries — and returns schema-validated facts plus bounded ordinal ratings. Deterministic
versioned code turns those into points. The model's response is stored verbatim, and `replay()`
recomputes from storage without ever re-invoking the model.

Three properties fall out of that split:

- **Replay** is bit-identical in perpetuity, even after the model is retired or upgraded.
- **Consistency** is exact for identical CVs, via a content-addressed extraction cache.
- **CV prompt-injection stops working** — a schema with no score field cannot be talked into
  awarding one. The worst an attacker achieves is exaggerating a fact, which is ordinary resume
  fraud that the integrity module already owns.

**Status:** ⏳ **Awaiting client approval of the document.** Two things block the build: their sign-off,
and the data-residency decision in its §13.
→ `questions.txt` §3G.

---

## Round 4 — Our Q6–Q13, answered 27 August late

### 4.1 Is the score behind the paywall?

**Answer — client, 2026-08-27:**

> *"Yeah the application for students/employers/colleges, is pay first only."*

**What we did:** Sign-up creates an account; everything else requires payment, for all three
audiences. A lapsed subscriber **keeps their account and score history and loses access** — never
their data.
→ `plan.md` Days 6, 11, 14.

---

### 4.2 KYB — automatic or manual?

**Answer — client, 2026-08-27:**

> *"KYB Onboarding form will be there, but it would be automatic, that is as soon as the user fills
> the employer portal, they have the access to portal, but nothing they can do inside the portal,
> unless they pay the price for it. Build the approval mechanism as well, and provide a setting to
> enable and disable it (upon disabling it, the approval becomes automatic)"*

**What we did:** This confirms the provisional decision we had already taken — build the full gate,
default the flag open. **Now settled rather than provisional.** Two independent gates that must not
be conflated: `kyb.require_approval` (config, default off) and an active paid subscription (the
real gate on employer actions). They fail differently and return different error codes. The
invariant-8 test runs with the flag *on* so the gate stays genuinely exercised whatever production
is set to.
→ `plan.md` invariant 8, Days 10 and 14.

---

### 4.3 What does an employer tier include? · was a BLOCKER

**Answer — client, 2026-08-27:**

> *"So no tiers for the employer payment, the employer pays once, (the value can be for
> monthly/quarterly/semi-annual/annual), now one time payment and for that time frame, every
> student is unlocked automatically for the employer, they can view anyone in the whole database."*

**What we did — this deleted more code than any other single answer:**

| Deleted | Was |
|---|---|
| `unlocks` table | Unique per (tenant, candidate), unlock-once-bill-once |
| `wallet_ledger` | Append-only employer balance |
| Unlock quote / price / balance display | SRS §2.25.2 |
| Unlock idempotency key | One of six named idempotent operations |
| Concurrent-double-charge test | Day 14's hardest correctness case |
| Employer tiers | Explicitly rejected |

Replaced by a single `require_active_access_window` check — the subscription *is* the entitlement.
Day 14 was one of four days flagged as uncompressible and most of it is gone, **recovering roughly
a day on the critical path.**

**Two things it did not remove:**

1. **The audit obligation.** PRD §3.9 requires every reveal of private data to be logged. Blanket
   access destroys the natural one-row-per-unlock trail, so the audit moves to the read — every
   profile opened writes a row. **Invariant 7′ is new for exactly this**, and
   `candidate_view_events` will be the fastest-growing table in the schema.
2. **🔴 The bulk-extraction risk** — see Round 5.1. This is the open item that matters most.

→ `plan.md` invariants 7 and 7′, §6, Days 13, 14, 15.

---

### 4.4 Employer type and industry lists

**Answer — client, 2026-08-27:**

> *"The onboarding Forms for all along with their fields will be provided at a bit later stage.
> Please mention what all is getting stuck due to this, if this is resolved in sometime?"*

**Our answer — nothing is hard-blocked.** Forms are built config-driven, so fields are data rather
than code. Helped by the fact that dropping employer tiers means employer type no longer affects
pricing, which was the expensive part to change late.

| Arrives | Cost |
|---|---|
| Within 2 weeks | No rework |
| 2–4 weeks | Minor — some guessed field types will be wrong |
| After 4 weeks | Real — screens built and tested against placeholders; admin filters need revisiting |
| Not before launch | Blocking |

**We now need three form specs, not one** — employer onboarding, **KYB** (since 4.2 kept that form
alive), and college onboarding — plus the two enumerated lists.
→ `questions.txt` §2B.

---

### 4.5 College seats — tiered or one-time?

**Answer — client, 2026-08-27:** Turned back to us as a question, plus a new mechanism:

> *"please confirm will there be tier wise breakdown for the college seats? Or one time payment for
> x number of students, else? Yeah if they do have an existing account, but they have a college
> sending them request as well, then there would be a referral type autogenerated code from the
> college side to the student, that the student has to enter in their applications to connect their
> id's with their colleges."*

**Our recommendation:** One payment per period covering up to N students. Not tiers — it mirrors
the employer model they just chose, avoids two billing systems, and keeps full commercial
flexibility, since "500 seats annual" and "2000 seats annual" are two price-list entries rather
than two systems.

**Referral codes — designed in, with three decisions we took:**

- **Entering a code is the consent act**, written as `granted_via = REFERRAL_CODE`. Arguably better
  consent than invite-accept, because the student takes a deliberate action.
- **It grants `ROSTER` scope only.** Individual visibility stays a separate explicit grant — PRD
  §3.8 requires the two to be distinct and a code must not silently confer both.
- **Codes are credentials** — non-guessable, rate-limited on entry, revocable, expiring. A
  guessable code lets anyone attach themselves to a roster, or lets a college harvest students who
  never agreed to anything.

Runs **alongside** the invite flow, not instead of it — invites still cover students with no account.

**Still open:** what happens at the seat limit — see Round 5.3.
→ `plan.md` §6, Day 17.

---

### 4.6 Subscriptions — auto-renew or manual?

**Answer — client, 2026-08-27:**

> *"Keep choice for the user, manual or UPI Mandate, if there are issues in it please let me know."*

**Our answer — no blocking issues, but two things worth knowing:**

**It is two billing flows, not one.** Both need building, testing and supporting. Offering the
choice is a real feature, not a checkbox.

**UPI AutoPay carries obligations that are the usual source of overrun:** per-subscriber mandate
registration, an amount ceiling fixed at registration, **pre-debit notification before every
charge**, debit failure and retry handling, and mandates the user can revoke **inside their own UPI
app, where we are never told**. We treat a silently dead mandate as a first-class state — detect on
failed debit, fall back to manual, notify before access lapses.

**Our sequencing:** manual first, mandate second behind the same interface, so a slip there does
not block launch. No decision needed from the client.
→ `plan.md` §6, Day 15.

---

### 4.7 Written confirmations — three of four

**Answer — client, 2026-08-27:**

> *"1. Paid Add Ons will increase the score. 2. Yes Sign up is required before anything and then
> payment as well, then only students will be having the scoring and tools available to them.
> 3. Yes, we won't be implementing duplicate CV feature. (Will confirm this once more)"*

| Item | Status |
|---|---|
| Paid add-ons increase the score *(reverses PRD rule 3)* | ✅ Confirmed |
| Sign-up before anything *(reverses SRS §2.25.1)* | ✅ Confirmed |
| Duplicate CV detection dropped *(reverses PRD §7.2)* | ⚠️ Provisional — client to re-confirm |
| **Score never explained** *(reverses PRD §4.2)* | 🔴 **Not addressed — re-asked** |

---

### 4.8 Data deletion policy

**Answer — client, 2026-08-27:** *"For data deletion policy we will discuss and let you know on it"*

**Status:** 🔴 Still open. See Round 0.5.

---

## Round 5 — Raised by us after their answers · ALL OPEN

### 5.1 🔴 Bulk extraction — needs a written acknowledgement · before Day 14

**Not a question we were asked. A consequence of two answers that nobody has looked at together.**

Round 4.2 means an employer is approved automatically, with nobody checking the business is real.
Round 4.3 means one payment buys visibility of every candidate in the database.

Together: **anyone with a payment card can pay for one month and extract the complete contact
details of every candidate on the platform** — candidates who themselves paid to be there. Under
the DPDP Act, that is a purpose-limitation and security question, not a product-design preference.

**We are building mitigations** — per-tenant daily and hourly view caps, rate limits on discovery
and reveal, velocity anomaly alerting to the admin console, and no bulk export of any kind. **They
are speed bumps, not a fix.** The fix is business verification, and the client has switched it off.

**What we need:** either a written *"yes, we understand, proceed"*, or they flip the verification
switch back on. We have recommended the switch, because they have **already asked us to build the
approval mechanism** — so it costs them almost nothing and removes most of the exposure.
→ `questions.txt` §1A.

---

### 5.2 Data residency — can CV data leave India? · blocks Day 8

The whole system sits in `ap-south-1` for DPDP residency. A CV is about as personal as data gets,
and the scoring design sends that text to a language model. **Amazon Bedrock does not support the
parameter that pins where inference runs**, so depending on model availability in Mumbai, the text
may be processed elsewhere.

This determines which client library the scoring module is built against, so it is needed before
Day 8. **It is a legal question about users' personal data and should be their counsel's answer,
not a default we set quietly in a config file.**
→ `questions.txt` §3G.

---

### 5.3 College seat limit behaviour · needed by Day 17

When a college with 500 seats adds the 501st student: block, allow and bill the overage, or allow
but cap analytics at 500? **We suggest block** — it is the only option that cannot produce a
surprise invoice, and surprise invoices to institutional customers become long email threads.
→ `questions.txt` §2C.

---

### 5.4 Score-explanation rescission · blocks Day 8

Round 3.3 removed the explanation, contradicting PRD §4.2. Not addressed in Round 4.7's
confirmations, so re-asked.

**Plus a knock-on the client may not have considered:** PRD §4.5 says a job listing tells a
candidate "what would need to improve" when they miss a threshold. That is an explanation too. We
are building generic messaging — *"your score does not meet this employer's requirement"* — with no
reasoning, and have flagged it for correction.
→ `questions.txt` §3D.

---

### 5.5 Calibration corpus · blocks Day 8

**50–100 real CVs** with a rough sense of what each should score, plus the relative importance of
the dimensions and any hard rules. Without it the weights are invented rather than calibrated, and
the golden-corpus CI gate has nothing to gate against.

Realistically **one working session** with whoever owns the product judgment — a few hours going
through real CVs and agreeing what "good" means. That session will do more for the quality of this
score than anything written in code.
→ `questions.txt` §3G.

---

## Everything still open, in one list

| # | Item | Blocks | Owner |
|---|---|---|---|
| 5.1 | 🔴 Written acknowledgement of the bulk-extraction risk | Day 14 | Client decision |
| ~~3.4~~ | ~~Approve `scoring-approach.md`~~ | — | ✅ **Approved 2026-08-30** |
| 5.2 | Data residency — can CV data leave India? | Day 8 | Client's counsel |
| 5.5 | Calibration corpus — 50–100 CVs | Day 8 | Client working session |
| 5.4 | Score-explanation rescission, plus the §4.5 knock-on | Day 8 | Client, one sentence |
| 0.5 | Data deletion vs. audit retention — **need a date** | Day 20 | Client's counsel |
| 5.3 | College seat limit behaviour | Day 17 | Client |
| 4.4 | Onboarding form fields ×3 + two enumerated lists | Soft, Day 9 | Client |
| 4.7 | Duplicate detection re-confirmation | Provisional | Client |
| 0.8 | Hire-event billing | Deliberately deferred | Client |
| **6.1** | **🔴 Course content — producer, format, timeline, completion rule** | **Now / Day 15** | **Client** |
| **6.2** | **Unlock-criteria rescission (SRS §2.25.2 ×3 and others)** | **Day 13** | **Client, one sentence** |
| **6.3** | **Referral-code consent vs. PRD rule 8's "invite-and-accept"** | Day 17 | Client, one sentence |
| **6.4** | **Plans, prices and the course catalogue** | Day 15 | Client |
| — | Language list and translation funding | Day 19 | Client |

---

## Round 6a — Client answer, 30 August

### 6a.1 ✅ `scoring-approach.md` APPROVED

**Answer — client, 2026-08-30:** approved.

**Closes N1**, which was one of three blockers on Day 8 and the only one that
was purely a sign-off. The extraction-plus-deterministic-scoring design is now
the agreed approach:

- The model **never emits a score.** It reads the CV and returns
  schema-validated facts plus bounded ordinal ratings; versioned code turns
  those into points.
- `replay()` recomputes from the **stored** model response and never re-invokes
  the model, so replay is bit-identical in perpetuity.
- Extraction is **content-addressed and cached**, so identical CVs are
  guaranteed identical scores.
- A schema with no score field **cannot be talked into awarding one**, which
  converts CV prompt-injection into ordinary resume fraud that the integrity
  module already owns.

**What this does NOT unblock.** Day 8 still has two open blockers, and neither
is engineering:

| Ref | Still needed | Owner |
|---|---|---|
| **N2** | Data residency — may CV text be processed outside India? Determines which client library the scoring module is built against. | Client's counsel |
| **N3** | Calibration corpus — 50–100 real CVs with expected bands, plus the relative importance of the dimensions. | Client, one working session |

Without N3 the weights are invented rather than calibrated and the golden-corpus
CI gate has nothing to gate against. Approval of the *approach* does not supply
the *judgment* — that is what the calibration session is for.

**Also still outstanding and now more urgent:** counsel's re-review of the score
(`plan.md` §13 Legal). The approved design is an AI-influenced hiring signal
that the subject cannot query, sold with items that provably raise it. Any
sign-off obtained before 27 August was given against a different product.

→ `plan.md` §3, §6, Day 8; `scoring-approach.md`.

---

## Round 6 — Raised by us on review, 30 August · ALL OPEN

**Not client answers. Four things we found by auditing our own record against the source
documents.** Three had never been put to the client at all.

### 6.1 🔴 Course content — never asked · scoping answer needed now

`resources-needed.md` has called this *"the largest unlisted dependency in the project"* since v4,
where it has sat without ever reaching `questions.txt` — the file that actually gets sent. **The
client sells one course; completing it adds 30 points.** Nobody has said who produces it, how long
it is, what format, or when it would exist.

**The part that is ours, not theirs:** *what counts as completion?* That is not a content question.
It decides what a `course_completions` row means, and that row moves a score — so it sits inside
invariant 3's blast radius and has to be something we can detect and a candidate cannot fake.

Also unscoped behind it: `course-media` bucket, a second CloudFront distribution, signed URLs, and
— against the stated primary segment of low-end Android on 2G — adaptive bitrate encoding. We have
suggested a text-and-image course as the dramatically cheaper option that actually serves that
audience, framed as a suggestion rather than a requirement.
→ `questions.txt` §3I1.

---

### 6.2 🔴 The unlock rescission was never asked for · before Day 13

**Our omission.** We chased written rescission twice for the score-explanation change — one
sentence in PRD §4.2 — and never once for **R14, the largest reversal in the project.**

Deleting the per-candidate unlock voids PRD §2 objective 2, PRD §3 rule 6, PRD §5.3, SRS §1.14.2,
§1.14.3, §1.20.8, §2.9.6, §2.9.7, and **three acceptance criteria in SRS §2.25.2** that cannot pass
as written: unlock price and balance before confirmation, unlock reveals only authorised data,
unlock creates an audit event.

The build is right and the criteria are stale — which is exactly what a written rescission is for.
Worth saying explicitly in the ask: **the third criterion survives in substance.** Invariant 7′
logs every profile an employer opens, so the client ends up with a *larger* audit trail than the
original design, not a smaller one. That is the point a security reviewer will look for.
→ `questions.txt` §3H1.

---

### 6.3 Referral-code consent vs. "invite-and-accept" · by Day 17

PRD §3 rule 8 does not just require consent, it names the mechanism: *"given via an
invite-and-accept flow."* R16 adds a typed referral code. We believe that is better consent and
have built it that way — but *"the student typed our code"* is not the same words, and this is a
consent mechanism under DPDP. One sentence closes it.
→ `questions.txt` §3H2.

---

### 6.4 Plans, prices and the course catalogue · never asked · by Day 15

Four candidate subscription prices, employer access-period prices, college seat pricing, the course
price, the mock-interview price. Nothing is blocked — Day 15 builds the machinery against
placeholders — but placeholders cannot go live. Worth pairing with the per-candidate cost figure
from `scoring-approach.md` §12 when they land, since that is what sets the subscription margin.
→ `questions.txt` §3I2.

---

*Companion to [`plan.md`](plan.md) v6.1, [`questions.txt`](questions.txt),
[`scoring-approach.md`](scoring-approach.md) and [`resources-needed.md`](resources-needed.md).
Client quotes are verbatim from the 24 August document comments, the 27 August note, and the
27 August answer rounds.*
