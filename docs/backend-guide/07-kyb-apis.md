# 07 — KYB (Know Your Business): input/output reference

The gate that's supposed to stand between "anyone can create a company
account" and "this company is allowed to publish jobs and see candidates."
Six endpoints, all under `/employer/kyb`, all **Owner only** — recruiters
and viewers have no part in verification.

**Read this doc's §0 before anything else** — it contains a fact about the
current build worth knowing before you assume this gate does what its name
suggests.

---

## 0. The big picture — and the thing worth knowing upfront

```
DRAFT ──(save answers, upload docs)──▶ still DRAFT ──submit──┐
                                                                │
                          require_approval OFF (today's default)
                                                                ▼
                                                           APPROVED
                                                          (immediately,
                                                       nobody reads the form)

                          require_approval ON (a config switch, not code)
                                                                ▼
                                                           SUBMITTED
                                                                │
                                                      (a human reviewer)
                                                                ▼
                                              APPROVED / REJECTED / MORE_INFO_REQUIRED
```

**The entire question of "does KYB actually verify anything" is one boolean**
— `config_values` key `kyb.require_approval`, `{"enabled": true|false}`. This
is genuinely the whole of a rule the client calls "R15." With it **off**
(which is the shipped default), the moment an Owner clicks submit with a
complete form, the organisation is marked `APPROVED` **immediately, and
nobody — no human, no code — reads a single answer they typed.** The form's
own source comment says this plainly:

> This form is currently decoration, and that is the risk worth naming...
> an employer fills this in, is approved automatically, pays, and can then
> read every candidate's contact details. Nothing below is checked by anyone.

**Why collect the form at all, then?** So that turning real review on later
is a policy flip, not a re-onboarding campaign — every organisation's
identifiers are already captured in valid formats and their documents are
already stored, waiting for a human to actually look at them the day this
switch flips.

**Why refuse to default the switch to "off" silently if the config row is
malformed**, rather than just falling back: a bad config row raises a `500`
(`kyb_config_invalid`) instead of quietly defaulting — because defaulting to
"off" on a config error would auto-approve organisations nobody meant to
approve, precisely when something has already gone wrong elsewhere.

This is exactly the same design shape as the confirm gate and the KYB-before
-publish check from earlier docs: **one clearly-named switch, one place it's
read, tested both ways** — not a rule that quietly does nothing while
looking, from the code around it, like it's doing something.

---

## 1. `GET /employer/kyb/form` — the form definition

**Auth required:** `EMPLOYER_OWNER` only.

**Request:** no body.

**Response** — `200 OK` (`KybFormResponse`):
```json
{
  "code": "employer_kyb",
  "version": "placeholder-1-2026-09-11",
  "sections": [
    {
      "code": "organisation",
      "title": "About your organisation",
      "fields": [
        { "code": "legal_name", "label": "kyb.legal_name", "type": "TEXT", "required": true, "max_length": 255 },
        { "code": "employer_type", "type": "SELECT", "required": true, "options_source": "employer.EMPLOYER_TYPES" }
      ]
    }
  ],
  "options": {
    "employer.EMPLOYER_TYPES": [{ "code": "PRIVATE_LIMITED", "label": "Private Limited Company" }],
    "reference.INDIAN_STATES": [{ "code": "KA", "label": "Karnataka" }]
  }
}
```
This is **data, not a hardcoded frontend form** — the same definition
renders identically across all four client apps, so a field added here
doesn't need four separate frontend changes. `version` is a real thing to
check: `"placeholder-1-2026-09-11"` marks that legal counsel hasn't signed
off on this exact wording/field set yet.

**Almost nothing is actually required.** The only universally-required
field is PAN — an Indian employer might be a private limited company with a
CIN, an LLP with an LLPIN, a partnership with neither, or a sole proprietor
with just a personal PAN. Demanding a CIN would exclude most small
employers in the country.

---

## 2. `GET /employer/kyb` — the organisation's current submission

**Auth required:** `EMPLOYER_OWNER` only.

**Request:** no body.

**Response** — `200 OK` (`KybSubmissionResponse`):
```json
{
  "submission_id": null,
  "state": "DRAFT",
  "form_version": null,
  "answers": {},
  "documents": [],
  "submitted_at": null,
  "reviewed_at": null,
  "decision_reason": null,
  "auto_approved": false,
  "review_flags": [],
  "reviews": [],
  "changed_since_last_review": null,
  "previous_submission_id": null
}
```
`submission_id: null` and `state: "DRAFT"` is the answer for an organisation
that hasn't saved anything yet — not an error, just a starting state.

Added 2026-10-10 for the review flow (§7):
- each document has a `url`, a short-lived link to the uploaded file;
- `review_flags` lists the fields and documents the reviewer wants corrected
  (`{"field": "pan", "note": "Use the PAN printed on the card"}`, or a
  document type such as `doc_pan`). **Highlight exactly these on the form.**
- `reviews` is every decision on this submission, oldest first (decision,
  reason, flags, time — never who reviewed);
- `changed_since_last_review` is `{fields, documents}` changed since the
  last decision, or `null` before the first one;
- `previous_submission_id` is set when this submission was started after a
  rejection and filled in from the rejected one.

---

## 3. `PUT /employer/kyb/answers` — save (partial, any number of times)

**Auth required:** `EMPLOYER_OWNER` only, and **only while the submission is
`DRAFT` or `MORE_INFO_REQUIRED`** — `409 kyb_not_editable` if it's
`SUBMITTED` or `UNDER_REVIEW`, and `409 kyb_already_verified` once approved.
**After a `REJECTED` decision, any save starts a new submission** filled in
with the rejected one's answers and documents (`{"answers": {}}` is enough
to start it). See §7.

**Request body** (`SaveAnswersRequest`):
```json
{
  "answers": {
    "legal_name": "Acme Private Limited",
    "employer_type": "PRIVATE_LIMITED",
    "pan": "ABCDE1234F"
  }
}
```
This is a **partial save**: fields you send replace what's stored, a field
sent as `null` clears it, and fields you leave out stay whatever they were.
**Nothing is required yet at this point** — required-field checking only
happens at `/submit` (§6), so a candidate — sorry, an employer — can save
half a form and come back to it later without being blocked by
incompleteness.

**Response** — `200 OK`, the updated `KybSubmissionResponse` (same shape as
§2), now with the merged `answers`.

**Errors:**
| Code | When |
|---|---|
| `422` | A malformed answer — the response lists **every** bad field at once, each with its own code, not just the first one found |
| `409 kyb_not_editable` | Submission already past the editable states |

---

## 4. `POST /employer/kyb/documents` — get an upload slot

**Auth required:** `EMPLOYER_OWNER` only.

**Request body** (`DocumentTicketRequest`):
```json
{ "doc_type": "pan_card" }
```

**Response** — `201 Created` (`DocumentTicketResponse`):
```json
{
  "upload_id": "9f2e...",
  "doc_type": "pan_card",
  "url": "https://s3.../presigned-put-url...",
  "method": "PUT",
  "expires_in_seconds": 900,
  "max_bytes": 10485760,
  "accepted_types": ["application/pdf", "image/jpeg", "image/png"]
}
```
**Exactly the same presigned-upload pattern as resume uploads**
([04](04-resume-and-scoring-apis.md)) — no `key` field (derived server-side
from the *organisation*, not the client, so an Owner can never write into
another organisation's document prefix), nothing saved to the database yet.
**What frontend does next:** `PUT` the file bytes directly to `url`.

## 5. `POST /employer/kyb/documents/{upload_id}/complete`

**Auth required:** `EMPLOYER_OWNER` only.

**Request body** (`CompleteDocumentRequest`):
```json
{ "doc_type": "pan_card" }
```

**Response** — `200 OK`, the updated `KybSubmissionResponse`, now with this
document listed under `documents`. Same "never trust the client" checks as
resume upload-complete: the object key is rebuilt from the *authenticated
organisation*, so completing an upload that belongs to a different
organisation simply finds nothing — `404`, not `403`.

**Uploading the same `doc_type` again replaces it** — `documents` in the
response is deduplicated by type, keeping the most recently uploaded one.

---

## 6. `POST /employer/kyb/submit` — the actual gate

**Auth required:** `EMPLOYER_OWNER` only.

**Request:** no body.

**What happens, in order:**
1. **Every required field and required document is checked** against the
   form definition (`validate_answers(..., complete=True)`). Missing
   anything → `422`, listing every issue by field, all at once.
2. Reads the `kyb.require_approval` config switch (§0).
3. Decides the target state: `SUBMITTED` if the switch is on, `APPROVED`
   immediately if it's off.
4. Writes that state onto **both** the KYB submission row **and**
   `employers.kyb_status` — the exact column the job-publish trigger reads
   ([05](05-jobs-and-discovery-apis.md) §6) — in the same transaction. This
   is why KYB approval and "can this org publish a job" are never two
   things that could drift apart: one write updates both.

**Response** — `200 OK` (`KybSubmissionResponse`):

With the switch **off** (today's default):
```json
{
  "submission_id": "3a1c...",
  "state": "APPROVED",
  "submitted_at": "2026-09-17T10:00:00Z",
  "reviewed_at": "2026-09-17T10:00:00Z",
  "auto_approved": true,
  ...
}
```

With the switch **on**:
```json
{
  "submission_id": "3a1c...",
  "state": "SUBMITTED",
  "submitted_at": "2026-09-17T10:00:00Z",
  "reviewed_at": null,
  "auto_approved": false,
  ...
}
```

**Errors:**
| Code | When |
|---|---|
| `422 kyb_answers_invalid` | Missing required fields/documents — lists every one |
| `409 kyb_invalid_transition` | Submission isn't in a state submit is legal from |
| `409 kyb_already_verified` | This organisation already has an `APPROVED` submission |
| `500 kyb_config_invalid` | The `kyb.require_approval` row exists but is malformed — refuses rather than guessing |

---

## 7. After `SUBMITTED`: review, send back, correct, resubmit (2026-10-10)

Only while approval is **manual** (the admin console's KYB switch). With it
on automatic, `submit` approves at once and none of this happens.

```
SUBMITTED ──► APPROVED                                   done; jobs can be published
    │
    ├──► MORE_INFO_REQUIRED  ("Send back")
    │        the SAME submission reopens: PUT /answers, re-upload documents,
    │        POST /submit again ──► SUBMITTED (the reviewer sees what changed)
    │
    └──► REJECTED            (final for this submission)
             the next PUT /answers (or document upload) starts a NEW submission,
             already filled in with the old answers and documents ──► submit
```

- **Both "Send back" and "Reject" carry a reason**, which the organisation
  reads as `decision_reason`, and may point at specific fields and documents
  in `review_flags`. Show the reason, and mark the flagged fields on the form.
- **Notifications** (in-app and email to every owner, with the reason
  included): sent back → `IN_APP_KYB_NEEDS_INFO` / `EMAIL_KYB_NEEDS_INFO`;
  rejected → `IN_APP_KYB_REJECTED` / `EMAIL_KYB_REJECTED`; approved → as
  before. Our staff (admins and KYB reviewers) get an **in-app** message
  for every submission and resubmission.
- After resubmitting, `review_flags` is empty again and the earlier decision
  stays in `reviews`.

The console side is [13 §1](13-admin-console-and-disputes-apis.md).

---

## Quick reference

| Endpoint | Auth | Editable states allowed |
|---|---|---|
| `GET /employer/kyb/form` | Owner | any |
| `GET /employer/kyb` | Owner | any (read-only) |
| `PUT /employer/kyb/answers` | Owner | `DRAFT`, `MORE_INFO_REQUIRED` |
| `POST /employer/kyb/documents` | Owner | `DRAFT`, `MORE_INFO_REQUIRED` |
| `POST /employer/kyb/documents/{id}/complete` | Owner | `DRAFT`, `MORE_INFO_REQUIRED` |
| `POST /employer/kyb/submit` | Owner | `DRAFT`, `MORE_INFO_REQUIRED` |
