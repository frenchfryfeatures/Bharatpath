# 03 — Login & signup APIs: input/output reference

Every endpoint involved in getting a candidate, employer, or college **from
"no account" to "logged in and set up."** Pulled directly from each module's
`schemas.py` and `router.py` — not summarised, the actual field names and
types.

Read [01-architecture.md](01-architecture.md) first for *why* auth works this
way (Cognito vs. `memberships`, the two pools). This doc is the *what* — the
literal request/response shape of every endpoint.

---

## 0. The big picture first — which app, which mechanism, which screens

There are **4 separate frontend apps** talking to this **one** backend
(candidate app, employer console, college console, admin console — see
[`how-it-all-connects.md`](../how-it-all-connects.md)). But underneath, there
are only **2 login mechanisms**, not 4:

| App | Login mechanism | Cognito pool | Has a separate "create org" screen? |
|---|---|---|---|
| Candidate app | Phone + OTP | `CANDIDATE` | ❌ No — logging in *is* signing up |
| Employer console | Email + Password + MFA | `BUSINESS` | ✅ Yes — "create your company" |
| College console | Email + Password + MFA | `BUSINESS` | ✅ Yes — "create your college" |
| Admin console | Email + Password + MFA | `BUSINESS` | ❌ No — doesn't exist yet (blockers.md) |

**Employer, college, and admin all authenticate through the exact same
backend code path** (`BUSINESS` pool, same `current_user`/
`current_business_identity` functions). The backend cannot tell them apart
*during login* — it only learns "which one is this" afterwards, by reading
`role` from `memberships` (`EMPLOYER_OWNER` vs `COLLEGE_ADMIN` vs
`PLATFORM_ADMIN`). They look like 3 different login screens only because
they're 3 different frontend apps, not because the backend treats them
differently.

### Sequence A — Candidate (login = signup, one call)

```
1. App:  POST /auth/otp/start  {phone}      → our backend (rate-limit only)
2. App:  Cognito InitiateAuth               → straight to AWS, not our backend
3. AWS:  Lambda → Twilio Verify sends the real SMS
4. User: types the code
5. App:  Cognito RespondToAuthChallenge     → straight to AWS
6. AWS:  returns a JWT (this is the "token")
7. App:  GET /auth/me  with that token      → our backend, confirms it worked
```
No separate signup step exists — step 6 already created the account if it
was a new number (`resolve_or_create_user`, see [01-architecture.md §4](01-architecture.md#4-authentication-who-is-this-and-what-can-they-do)).

### Sequence B — Employer / College (login, THEN a separate signup step)

```
1. (once, outside any app) our team creates the Cognito account by hand
2. App:  user logs in with email + password + MFA code → Cognito → JWT
3. App:  GET /auth/me   with that token
      ├─ 200 OK, tenant_id present    → this account already has a company
      │                                  → go straight to the dashboard
      └─ 403 no_active_membership     → this account has NO company yet
                                          → show the "create your company" screen
4. App (only on the 403 branch):
      GET /employer/reference   → fetch the dropdown options for that screen
      (this call has NOTHING to do with login — see the callout below)
5. User fills the form, app calls:
      POST /employer/organisation  {legal_name, employer_type, industry}
      → this is what actually creates the company and makes the caller its Owner
6. App:  GET /auth/me again   → now tenant_id is present → go to dashboard
```

**Why `GET /employer/reference` shows up here and what it actually is:**
it is *not* an authentication step and it is *not* required to log in. It
exists purely to answer one question for the UI: *"what options should the
Employer Type and Industry dropdowns show?"* Compare it to an e-commerce
checkout form calling an API to fetch the list of Indian states for an
address dropdown — nothing about login or accounts is decided by that call.
It only gets called at the exact moment the "create your company" form is
about to be shown (step 4 above), never before, never as part of steps 1–3.

College follows the identical sequence, one-for-one: `GET
/college/organisation` instead of the reference call's target, `POST
/college/organisation` instead of `POST /employer/organisation`, and its own
`institution_type` dropdown instead of `employer_type`/`industry`.

### So, to directly answer "will there be 3 different screens?"

Yes, practically — because employer/college/admin are 3 separate frontend
codebases, each ends up with its own copy of the "email + password + MFA"
login screen, even though all 3 copies call the exact same backend
endpoints in the exact same way. And **2** of those apps (employer, college)
additionally need a one-time "create your organisation" screen that the
candidate app and admin console don't need at all. Nothing about this is a
backend decision — the backend exposes one login mechanism per pool (2
total) and one "create org" endpoint per audience (2 total); how many
screens wrap them is purely a frontend/product choice.

---

## 1. Candidate login

### `POST /auth/otp/start`

**This route does not exist at all unless `AUTH_PHONE_OTP_ENABLED=true`** —
the same "genuinely absent, not just refused" pattern as `/auth/dev/token`
in §3 below: it's registered at import time only when the flag is on, so
while it's off the route is missing from the running app *and* from
`openapi.json`, not just returning an error. **Phone OTP is deferred by the
client (2026-09-18)** — candidates sign in a different way in the meantime
(see [`docs/signup-and-accounts.md`](../signup-and-accounts.md)); this
section describes what runs once the flag is switched back on.

Public. No token needed — this is how a session *begins*.

**Request body** (`OtpStartRequest`):
```json
{ "phone": "+919876543210" }
```
| Field | Type | Rule |
|---|---|---|
| `phone` | string | Must be E.164 format: starts with `+`, digits only, 8–20 chars. `+91 98765 43210` (with spaces) is rejected — client must send `+919876543210`. |

**Response** — `202 Accepted` (`OtpStartResponse`):
```json
{ "status": "CHALLENGE_SENT", "retry_after_seconds": 3600 }
```
| Field | Meaning |
|---|---|
| `status` | Always `"CHALLENGE_SENT"` — literally, whether or not that phone number has an account. |
| `retry_after_seconds` | How long the client should wait before letting the user hit "resend" again. |

**What this endpoint does NOT do:** it does not send the OTP. It's a
rate-limiter sitting in front of Cognito. After this call succeeds, the
**client calls AWS Cognito directly** (`InitiateAuth` with the custom-auth
flow) — Cognito's Lambda triggers call Twilio Verify, which generates, sends
and checks the actual code. This backend never sees the OTP value.

**Errors:**
| Code | When |
|---|---|
| `429` | Too many attempts for this phone number or this IP in the last hour. |
| `422` | Phone number isn't valid E.164. |

**Why the response looks identical for a real vs. unregistered number:**
telling the caller "no account with this number" turns the login screen into
a tool for checking whether someone specific has signed up — a privacy leak
with no real upside for the honest user either.

---

### `POST /auth/resume-preview` — read a CV before the account exists

Step 1 of candidate sign-up ("Basic details") can start from a CV: the app
sends the file, gets the facts back, and fills the form with them. **No
token**: the person has no account yet. The whole flow is in
[`docs/student-career-onboarding.md`](../student-career-onboarding.md).

**Nothing is kept.** No file is stored, no user is looked up or created, no
resume version is written and nothing is scored. After sign-up, the app sends
the same file again to `POST /candidate/resume/intake`
([04](04-resume-and-scoring-apis.md) §3b), which is where it is stored.

**Request:** `multipart/form-data` with one part, `file`: a PDF or `.docx`,
at most 10 MB. The type is sniffed from the bytes, never taken from the
filename.

**Response** — `200 OK`:
```json
{
  "full_name": "Priya Sharma",
  "email": "priya@example.com",
  "details": {
    "phone": "+919876543210",
    "work_status": "EXPERIENCED",
    "currently_employed": "YES",
    "experience_years": 3, "experience_months": 4,
    "company_name": "Acme", "job_title": "Data Analyst",
    "current_city": "Pune",
    "key_skills": ["SQL", "Excel"],
    "highest_qualification": "B.Tech", "course": "Computer Science",
    "institution": "COEP", "starting_year": 2016, "passing_year": 2020,
    "...": "every other CareerDetails field, blank when not found"
  }
}
```
`details` has the shape of `CareerDetails` (see [05](05-jobs-and-discovery-apis.md)
§10b). Parsing never guesses salary, gender or preferences; anything it
cannot read stays blank (`""`, `null` or `0`).

**Errors:**

| Status | `code` | When |
|---|---|---|
| 422 | `upload_empty` / `upload_too_large` / `upload_unrecognised_type` / `upload_legacy_doc_unsupported` / `upload_unsupported_type`, with `params.detail` | Not a usable PDF or `.docx`. Legacy `.doc` has its own code so the app can say "save as PDF or .docx" |
| 429 | `rate_limited` | 30 per hour **per IP** (`resume.preview`) — it calls a model, and there is no account to limit by |
| 503 | `resume_prefill_unavailable` | The model could not read it. Let the person type their details instead |

## 2. Whoami (works for every role, once logged in)

### `GET /auth/me`

Requires: a valid bearer token (any pool, any role).
```
Authorization: Bearer <token>
```

**No request body.**

**Response** — `200 OK` (`MeResponse`):
```json
{
  "user_id": "9f2e1a3c-...",
  "role": "CANDIDATE",
  "pool": "CANDIDATE",
  "tenant_id": null
}
```
| Field | Type | Meaning |
|---|---|---|
| `user_id` | UUID | Our internal id. **Never** the Cognito `cognito_sub` — that must never leave the backend. |
| `role` | string | One of the 10 roles (`CANDIDATE`, `EMPLOYER_OWNER`, `COLLEGE_ADMIN`, ...), read from `memberships` — not from the token. |
| `pool` | string | `"CANDIDATE"` or `"BUSINESS"` — which Cognito pool issued the token. |
| `tenant_id` | UUID or `null` | The caller's organisation. Always `null` for a candidate. |

**Errors:**
| Code | When |
|---|---|
| `401` | No token, malformed token, expired, or the account is suspended/deleted. |
| `403 pool_role_mismatch` | A candidate-pool token somehow resolved to a business membership (or vice versa) — refused, never honoured. |
| `403 no_active_membership` | A verified business account with no membership yet (invited but hasn't joined, or just removed). |

---

## 3. Dev-only token (local/test environments only)

### `POST /auth/dev/token`

**This route does not exist at all unless `AUTH_ALLOW_LOCAL_TOKENS=true`** —
not "returns an error," genuinely absent from the app and from
`openapi.json`. `Settings` additionally refuses to boot with this flag on in
staging/prod. It exists so development and CI can get a real, working token
without a real Cognito pool.

**Request body** (`DevTokenRequest`):
```json
{ "pool": "CANDIDATE", "subject": null, "phone": "+919876543210", "email": null }
```
| Field | Type | Rule |
|---|---|---|
| `pool` | `"CANDIDATE"` \| `"BUSINESS"` | Default `"CANDIDATE"`. |
| `subject` | string or null | Reuse this to sign back in as the *same* fake local user across calls. |
| `phone` / `email` | string or null | Identity fields for the minted token. |

**Response** — `200 OK` (`DevTokenResponse`):
```json
{ "access_token": "eyJhbGc...", "token_type": "Bearer", "subject": "local-...", "expires_in": 3600 }
```

This is a genuine RS256-signed JWT, verified through the exact same code path
as a real Cognito token — only the issuer differs. It is not a stub that
skips checks.

---

## 4. Employer signup

**As of 2026-09-18, anyone can self-register in the business pool** —
`SignUp` + `ConfirmSignUp` straight against Cognito, exactly like the
candidate pool, closing what used to be an admin-create-only restriction
(blockers E7). The flow below (get a verified business account, then
create your organisation through these endpoints) is unchanged either way
— self-registration and platform-staff provisioning both land the caller
at the same "verified business account, no organisation yet" starting
point.

**There is also a second way an employer or college account comes to
exist: our own staff make one on someone's behalf**,
`POST /admin/accounts/employers` / `/admin/accounts/colleges` — see
[13-admin-console-and-disputes-apis.md §7](13-admin-console-and-disputes-apis.md#7-accounts-made-on-someones-behalf--adminaccounts-admintenantsidmembers).
Cognito emails a temporary password instead of the person choosing one
themselves, but from `GET /employer/reference` onward the sequence below is
identical.

### `GET /employer/reference`

Requires: a verified business-pool account (`current_business_identity`) —
does **not** require an organisation to exist yet. This is what the signup
form's dropdowns are populated from.

**No request body.**

**Response** — `200 OK` (`ReferenceResponse`):
```json
{
  "employer_types": [{"code": "PRIVATE_LIMITED", "label": "Private Limited Company"}, ...],
  "industries": [{"code": "IT_SERVICES", "label": "IT Services"}, ...]
}
```
Only **active** codes — a retired code can still exist on an old row, but
can never be freshly chosen.

### `POST /employer/organisation`

Requires: verified business account, **no organisation yet**.

**Request body** (`CreateOrganisationRequest`):
```json
{ "legal_name": "Acme Pvt Ltd", "employer_type": "PRIVATE_LIMITED", "industry": "IT_SERVICES" }
```
| Field | Type | Rule |
|---|---|---|
| `legal_name` | string | 2–255 chars, whitespace collapsed. Required. |
| `employer_type` | string or null | Must be one of the *active* codes from `/employer/reference`. |
| `industry` | string or null | Same. |

**Response** — `201 Created` (`OrganisationResponse`):
```json
{
  "tenant_id": "3c9f...",
  "legal_name": "Acme Pvt Ltd",
  "employer_type": "PRIVATE_LIMITED",
  "industry": "IT_SERVICES",
  "kyb_status": "DRAFT"
}
```
The caller automatically becomes that organisation's **Owner**. `kyb_status`
starts at `DRAFT` — the org exists, but isn't verified yet (that's a
separate flow, [`/employer/kyb/*`](02-api-checklist.md)); it cannot publish a
job until KYB clears.

**Errors:**
| Code | When |
|---|---|
| `409 identity_already_in_organisation` | This account already belongs to an org — **including a suspended one**. Can't escape a suspension by "signing up again." |
| `422` | An `employer_type`/`industry` code that isn't in the active list — or a smuggled field like `tenant_id` (schemas use `extra="forbid"` specifically so a client can never *send* a tenant id; SRS 2.24.7 requires the tenant to always come from the server side). |

### `GET /employer/organisation`

**Auth required:** any employer role (Owner, Recruiter, or Viewer).

**Request:** no body, no path parameter — "which org" comes from the
caller's own membership, never from a URL, so there's nothing to send
beyond the `Authorization` header.

**Response** — `200 OK` (`OrganisationResponse`) — same shape `POST
/employer/organisation` returns:
```json
{
  "tenant_id": "3c9f...",
  "legal_name": "Acme Pvt Ltd",
  "employer_type": "PRIVATE_LIMITED",
  "industry": "IT_SERVICES",
  "kyb_status": "DRAFT"
}
```

### `PATCH /employer/organisation`

**Auth required:** **Owner only** — Recruiter/Viewer get `403`.

**Request body** (`UpdateOrganisationRequest`) — partial update, every field
optional, but **at least one must be present**:
```json
{ "legal_name": "Acme Private Limited" }
```
| Field | Type | Rule |
|---|---|---|
| `legal_name` | string or omitted | Can never be sent as `null` — an org must always have a name |
| `employer_type` | string, `null`, or omitted | `null` explicitly **clears** it; omit to leave unchanged |
| `industry` | string, `null`, or omitted | Same as above |

**Response** — `200 OK`, the updated `OrganisationResponse`, same shape as
`GET` above.

**Note:** `kyb_status` is not, and will never be, a field this endpoint can
set — it only moves through the KYB module's own state machine. Letting a
PATCH touch it would be a one-line bypass of invariant 8.

---

## 5. Employer team management

### `GET /employer/team`

Requires: any employer role. Lists active members.

**Response** — `200 OK`, array of `TeamMemberResponse`:
```json
[{ "user_id": "...", "email": "recruiter@acme.com", "role": "EMPLOYER_RECRUITER", "added_at": "2026-09-01T10:00:00Z" }]
```

### `POST /employer/team`

Requires: **Owner only**.

**Request body** (`AddTeamMemberRequest`):
```json
{ "email": "new.recruiter@acme.com", "role": "EMPLOYER_RECRUITER" }
```
`role` must be one of `EMPLOYER_OWNER`, `EMPLOYER_RECRUITER`, `EMPLOYER_VIEWER`.

**Response** — `201 Created`, a `TeamMemberResponse`.

**What actually happens:** if no account exists for that email, one is
created right now (empty, unclaimed). **Access activates the first time that
address logs in** — there's no separate "accept invite" click.

**Errors:**
| Code | When |
|---|---|
| `409 identity_already_a_member` | Already on *this* org's team. |
| `409 identity_cannot_add_member` | The address belongs to a candidate, or to *another* org's team member. **One error code for both reasons, deliberately** — telling them apart would let an Owner probe whether an arbitrary email address has an account anywhere on the platform. |

### `PATCH /employer/team/{user_id}`

Requires: **Owner only**. Body: `{"role": "EMPLOYER_VIEWER"}`. `404` (not
403) if `user_id` isn't a member of *this* org — existence of a row in
another tenant is never confirmed. `409 identity_last_owner` if this would
leave the org with zero owners.

### `DELETE /employer/team/{user_id}`

Requires: **Owner only**. `204 No Content`, no body. This **revokes**, never
deletes, the membership row (it's kept as a record of who could see what,
and when) — access ends on the *very next request* that user makes, because
removing it also drops the 60-second Redis cache immediately rather than
waiting it out. Same `identity_last_owner` guard as above.

---

## 6. College signup & team

Structurally identical to employer — same `current_business_identity` →
create org → invite team pattern — with college-specific fields. Every
endpoint below needs `Authorization: Bearer <token>` exactly like every
other endpoint in this doc; only the *role* required changes per endpoint,
noted each time.

### `POST /college/organisation`

**Auth required:** verified business-pool account (`current_business_identity`)
— **no college yet**, same as the employer's equivalent.

**Request body** (`CreateCollegeRequest`):
```json
{ "name": "IIT Example", "institution_type": "ENGINEERING_COLLEGE" }
```
| Field | Type | Rule |
|---|---|---|
| `name` | string | 2–255 chars |
| `institution_type` | string | One of: `UNIVERSITY`, `AUTONOMOUS_COLLEGE`, `AFFILIATED_COLLEGE`, `ENGINEERING_COLLEGE`, `MANAGEMENT_INSTITUTE`, `POLYTECHNIC`, `ITI`, `TRAINING_INSTITUTE`, `OTHER` |

**Response** — `201 Created` (`CollegeResponse`):
```json
{
  "tenant_id": "3c9f...",
  "name": "IIT Example",
  "institution_type": "ENGINEERING_COLLEGE",
  "onboarding_submitted_at": null,
  "verified_at": null,
  "created_at": "2026-09-17T10:00:00Z"
}
```
Two extra fields employer's `OrganisationResponse` doesn't have:
`onboarding_submitted_at` and `verified_at` — a college goes through its own
separate onboarding-questions flow (`GET/PUT /college/onboarding*`, not
covered in this doc) instead of KYB.

**Errors:** same as the employer version — `409
identity_already_in_organisation` if this account already has one.

### `GET /college/organisation`

**Auth required:** `COLLEGE_ADMIN` or `COLLEGE_STAFF`.

**No request body.** No path parameter either — "which college" comes from
the caller's own membership, never from the URL.

**Response** — `200 OK`, the same `CollegeResponse` shape shown above.

### `PATCH /college/organisation`

**Auth required:** `COLLEGE_ADMIN` only.

**Request body** (`UpdateCollegeRequest`) — partial, at least one field:
```json
{ "name": "Indian Institute of Technology, Example" }
```
| Field | Type | Rule |
|---|---|---|
| `name` | string or omitted | 2–255 chars if sent |
| `institution_type` | string or omitted | same closed list as create |

**Response** — `200 OK`, updated `CollegeResponse`.

### `GET /college/team`

**Auth required:** `COLLEGE_ADMIN` or `COLLEGE_STAFF`.

**No request body.**

**Response** — `200 OK`, array of `TeamMemberResponse`:
```json
[{ "user_id": "...", "email": "staff@iit-example.edu", "role": "COLLEGE_STAFF", "added_at": "2026-09-01T10:00:00Z" }]
```

### `POST /college/team`

**Auth required:** `COLLEGE_ADMIN` only.

**Request body** (`AddTeamMemberRequest`):
```json
{ "email": "new.staff@iit-example.edu", "role": "COLLEGE_STAFF" }
```
`role` is one of `COLLEGE_ADMIN` / `COLLEGE_STAFF` — no three-tier
owner/recruiter/viewer split like employer has, just these two.

**Response** — `201 Created`, a `TeamMemberResponse`. Same "access activates
on first login, no accept-invite step" behaviour as the employer version.

**Errors:** same shape as employer's — `409 identity_already_a_member`,
`409 identity_cannot_add_member` (one generic code for every reason
involving someone else's account, so this can't be used to probe whether an
email has an account anywhere on the platform).

### `PATCH /college/team/{user_id}`

**Auth required:** `COLLEGE_ADMIN` only.

**Request body** (`ChangeRoleRequest`):
```json
{ "role": "COLLEGE_ADMIN" }
```

**Response** — `200 OK`, updated `TeamMemberResponse`. `404` (not 403) for a
`user_id` outside this college. `409 identity_last_owner` if this would
leave the college with zero admins — `COLLEGE_ADMIN` plays the "owner" part
here, same last-one-standing guard as employer's `EMPLOYER_OWNER`.

### `DELETE /college/team/{user_id}`

**Auth required:** `COLLEGE_ADMIN` only.

**No request body.**

**Response** — `204 No Content`, empty. Revokes (never deletes) the
membership row, effective immediately — same as employer's version.

---

## Quick reference: which endpoints need what

| Endpoint | Auth dependency | Meaning |
|---|---|---|
| `POST /auth/otp/start` | none | public |
| `GET /auth/me` | `current_user` | any valid token |
| `GET /employer/reference`, `POST /employer/organisation` | `current_business_identity` | verified business account, **org optional** |
| `GET/PATCH /employer/organisation`, `GET /employer/team` | `require_role(OWNER, RECRUITER, VIEWER)` | any employer role |
| `POST/PATCH/DELETE /employer/team/*` | `require_role(OWNER)` | Owner only |
| College endpoints | mirror the employer ones, `COLLEGE_ADMIN`/`COLLEGE_STAFF` |

See [01-architecture.md §4](01-architecture.md#4-authentication-who-is-this-and-what-can-they-do)
for what each of these dependency functions actually checks.
