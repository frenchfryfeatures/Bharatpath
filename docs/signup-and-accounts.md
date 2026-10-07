# Sign-up, accounts and discount codes

Built 2026-09-18 from the client's *Signup_Login_Discussion_Updates* note
(`docs/Signup_Login_Discussion_Updates .pdf`). This is the reference for the
app and web teams; the API reference is `openapi.json` / `docs/APIs.md`.

## What the client decided

| Topic | Decision |
|---|---|
| Who can sign up | **Anyone**, as a candidate, an employer or a college. Staff can also create any of the three. |
| How people sign in | **Email and password only**, on both Cognito pools. Business accounts **may** turn on an authenticator app (MFA) in their settings; it is **off by default** (client, 2026-10-07). See [MFA for business accounts](#mfa-for-business-accounts-optional). |
| Password rules | Set in Cognito (`infra/terraform/cognito.tf`), not the API. **Candidates and students: at least 8 characters**, with upper case, lower case and a number. **Employers, colleges and staff: at least 12**, with upper case, lower case, a number and a symbol (2026-10-05; were 12 and 14). Apps should show the same rule before calling `SignUp`. |
| Phone OTP | **Deferred**, and there is **no SMS of any kind**, until the organisation's registration (and with it TRAI DLT) exists. Every code and every message goes by email or to the in-app inbox. |
| Codes by email | **Cognito sends them**: sign-up verification, password reset, and the temporary password of a staff-created account. It sends through Amazon SES once the client's domain is verified. The backend never generates or checks a code. |
| Discount codes | Staff create them in the console. Payers apply them to a subscription checkout. The policy is a **placeholder** until the client answers three questions (below). |
| Profile scoring | **No change** for now. |

## The four ways in

### 1. Standard sign-up (self-registration)

The app talks to Cognito directly; our API has no login endpoint.

**Candidate** (candidate pool):

1. The app calls Cognito `SignUp` with email and password.
2. Cognito emails a 6-digit code, and the app calls `ConfirmSignUp`.
3. The app signs in (SRP) and calls the API with the access token.
4. The first API call creates the account (`GET /auth/me` → `role: CANDIDATE`).
5. The app asks for the name (`PUT /candidate/profile/name`, blockers E13), then the usual onboarding: location, CV, subscription.

**Employer or college** (business pool):

1. `SignUp` → emailed code → `ConfirmSignUp`.
2. First sign-in: email and password only. **No MFA setup step** -- MFA is off until the user turns it on in settings. A user who has turned it on is asked for the 6-digit code at every sign-in.
3. `GET /auth/me` → **403 `no_active_membership`**. This is expected, and means "create your organisation".
4. The user picks employer or college, and the app calls `POST /employer/organisation` or `POST /college/organisation`. They become its owner or admin.
5. The usual onboarding follows: KYB or college onboarding, then a subscription (with an optional discount code).

### 2. Sign-up with a discount code

The same as 1, and at the subscription step:

```http
POST /{candidate|employer|college}/subscription/checkout/discount-preview
{"plan_code": "CANDIDATE_MONTHLY", "discount_code": "launch50"}
→ 200 {"list_amount_minor": 14900, "discount_minor": 2980, "amount_minor": 11920}

POST /{candidate|employer|college}/subscription/checkout
{"plan_code": "CANDIDATE_MONTHLY", "discount_code": "launch50"}
→ 201 {"payment_id": "...", "amount_minor": 11920, "list_amount_minor": 14900, ...}
```

- **Case does not matter.**
- **Refusals are 422, with a `code` to show a message for:**

  | Code | When |
  |---|---|
  | `discount_code_invalid` | Unknown, switched off, not started yet, or for another kind of account. These are deliberately indistinguishable. |
  | `discount_code_expired` | The code's end date has passed. |
  | `discount_code_exhausted` | The code has reached its usage limit. |
  | `discount_code_already_used` | This person or organisation has used it before. |
  | `discount_exceeds_price` | The code would take the price below ₹1. |

- **Rate limit:** 40 tries an hour per person, shared by preview and checkout.
- **The preview holds nothing.** A code can be used up between preview and checkout.
- **A checkout holds one use for 30 minutes**, so the last use of a code cannot be sold twice.
- **A code counts as used only when the payment succeeds.** Abandoning a checkout does not use it.
- **Only the checkout reads a code.** A manual renewal is a checkout and may carry one. An automatic UPI renewal never does.

### 3. Staff create the account

Console routes (`/admin`, PLATFORM_ADMIN):

| Route | Creates |
|---|---|
| `GET /admin/accounts/forms` | The employer (KYB) and college onboarding forms as staff may fill them |
| `POST /admin/accounts/candidates` `{email, full_name?, city?, state_code?}` | A candidate account |
| `POST /admin/accounts/employers` `{owner_email, legal_name, employer_type?, industry?, kyb_answers?}` | An employer and its owner |
| `POST /admin/accounts/colleges` `{admin_email, name, institution_type, onboarding_answers?}` | A college and its admin |
| `POST /admin/tenants/{tenant_id}/members` `{email, role}` | A member of an existing employer or college |
| `POST /admin/accounts/{user_id}/resend-invitation` | The email again; support can do this too |

What happens:

1. The API creates our account row, and the organisation if there is one, with the person as owner or admin.
2. It then asks Cognito for the sign-in (`AdminCreateUser`). **Cognito emails a temporary password**, valid for 7 days.
3. The person signs in with it and Cognito forces a new password. MFA is off until they turn it on themselves.
4. The first API call finds the row staff made, matching by email and within the same pool, and the organisation and role are already there. Onboarding continues as usual: an organisation made by staff still does its own KYB and pays like any other.

Response `invitation` is `SENT`, or `ALREADY_REGISTERED` if the person already had a sign-in (no email went out; they sign in as usual).

- **If Cognito refuses, nothing is created** (502 `account_directory_unavailable`).
- **Staff cannot link a student to a college.** Linking is the student's consent, so they do it themselves after signing in, with a code or by accepting the college's invitation.

#### Staff fill the onboarding in for them (2026-10-03)

Staff creating an account can send what they already know with it. (No console screen for this yet; it is backend only.) It is saved as a **draft, never submitted**. The person signs in with the emailed password and finds the form already filled.

| Invited | Staff may fill | Stays with the person |
|---|---|---|
| Employer | Every KYB answer: organisation, identifiers, address, contact (`kyb_answers`) | The undertakings, the documents, and **submitting**. With approval off, submitting *is* approval |
| College | Every onboarding answer: institution, address, placement office, cohort (`onboarding_answers`) | The undertakings and submitting |
| Candidate | Name, city, state | CV upload and confirmation, the questionnaire, any college link |

- **The field codes come from `GET /admin/accounts/forms`**, the published form definitions minus every `CHECKBOX` (on these forms always an undertaking) and `FILE`. Sending one anyway is 422 `kyb_answers_invalid` / `college_onboarding_invalid` with issue `not_staff_fillable`, even as `false`.
- Answers are validated like the person's own partial save. **Any refusal creates nothing and emails nobody**: the rows are written first and the invitation last, in one transaction.
- `legal_name`, `employer_type`, `industry` (and a college's `name`, `institution_type`) are copied into the draft even without `kyb_answers`, so nobody types the organisation's name twice. They win over the same codes in the answers.
- The response's `prefilled` lists the codes saved. The `account_provisioned` audit row records the same codes, **not the values**, so it is always clear which answers were ours rather than the person's.

### 4. Organisation email invitation

Staff creating an employer or college (3) *is* the invitation to its owner. Adding a member (`/admin/tenants/{id}/members`) invites a colleague. An owner adding a colleague in their own team screen (`POST /employer/team`, `POST /college/team`) now sends the same Cognito email to anyone who has never signed in.

## MFA for business accounts (optional)

Client, 2026-10-07 (closing blockers E37). Employers, colleges and staff
**may** use an authenticator app (Google Authenticator, Microsoft
Authenticator, Authy). It is **off by default**, and each user turns it on or
off in their own settings. Candidates have no MFA.

- **The API is not involved.** There is no endpoint for MFA and the API never
  checks it; the app talks to Cognito directly with Amplify, using the
  signed-in user's session.
- **Sign-in** (`frontend/lib/auth/cognito.ts`) already handles it. A user with
  MFA on gets `CONFIRM_SIGN_IN_WITH_TOTP_CODE` (ask for the 6-digit code); a
  user with it off goes straight to `DONE`. `CONTINUE_SIGN_IN_WITH_TOTP_SETUP`
  no longer happens, because nobody is forced to set up.
- **Users who set it up while it was mandatory still have it on**, and are
  asked for the code until they turn it off.

The settings toggle, with `aws-amplify/auth` (v6):

| Step | Call |
|---|---|
| Show whether it is on | `fetchMFAPreference()` → on when `enabled` includes `"TOTP"` |
| Turn on, 1: get a secret | `setUpTOTP()` → show `getSetupUri("BharatPath", email)` as a QR code, and `sharedSecret` as text for manual entry |
| Turn on, 2: prove the app works | the user types the 6-digit code → `verifyTOTPSetup({ code })` |
| Turn on, 3: switch it on | `updateMFAPreference({ totp: "PREFERRED" })` -- **without this step it stays off** |
| Turn off | `updateMFAPreference({ totp: "DISABLED" })` |

- **Cognito asks for no code to turn MFA off**: any signed-in session can.
  Ask for the current 6-digit code (or the password) in the UI before calling
  it.
- **Lost phone**: there is no self-service recovery. Staff reset it:
  `aws cognito-idp admin-set-user-mfa-preference --user-pool-id <business pool> --username <email> --software-token-mfa-settings Enabled=false,PreferredMfa=false`.

## Discount codes in the console

| Route | Who |
|---|---|
| `POST /admin/discount-codes` | PLATFORM_ADMIN |
| `POST /admin/discount-codes/{id}/disable` | PLATFORM_ADMIN |
| `GET /admin/discount-codes`, `GET /admin/discount-codes/{id}` | PLATFORM_ADMIN, SUPPORT_AGENT |
| `GET /admin/discount-codes/{id}/redemptions` (the usage log) | PLATFORM_ADMIN, SUPPORT_AGENT |

Fields, as the client's note listed them:

| Client's field | API field |
|---|---|
| Discount Code | `code` (omit it to have one generated: 10 characters, no 0/O/1/I/L) |
| Generated For | `audience`: `CANDIDATE`, `EMPLOYER`, `COLLEGE` |
| Discount Value | `percent_off` (1–99) **or** `amount_off_minor` (paise) |
| Generated By | `created_by` |
| Created At | `created_at` |
| Expiry | `valid_until`; there is also `valid_from` |
| Usage Limit | `usage_limit` (null: unlimited) |
| Usage Count | `usage_count` |
| Used By | redemption rows: `user_id`, `subscriber_type`/`subscriber_id`, and `organisation` for an employer or college |
| Used At | redemption `redeemed_at` |
| Status | `ACTIVE`, `SCHEDULED`, `EXPIRED`, `EXHAUSTED`, `DISABLED`. It is worked out when read. |

- **A code's terms never change once it exists.** To change a code, switch it off and make another. The database enforces this.
- **Creating and switching off are audited.**

### Waiting on the client (placeholder policy, `DISCOUNT_POLICY_VERSION`)

1. **Can a code be 100%?** Today no: a payment of zero cannot go through the gateway, and only a verified gateway callback grants access. Percentages are 1–99, and a fixed amount must leave at least ₹1.
2. **Does a code apply to renewals?** Today only to the checkout that carries it. An automatic renewal is at full price.
3. **Can the same person or organisation use a code twice?** Today no.

## Email delivery: what the client needs to provide

- **A domain** they own, e.g. `bharatpath.in`, and access to its DNS.
- **We set `email_domain`** in Terraform (`infra/terraform/ses.tf`). `terraform output email_dns_records` then lists five records to add once: three DKIM CNAMEs, a MAIL FROM MX and SPF TXT, and a DMARC TXT. If the DNS is a Route 53 zone in our AWS account, setting `route53_zone_id` makes Terraform add them itself.
- **SES production access:** a support request in the AWS console, usually answered within a day. Until then SES only delivers to verified addresses.

Until the domain exists, Cognito uses its own sender (about 50 emails a day, development only) and notification emails are recorded as not sent (`PROVIDER_UNCONFIGURED`).
