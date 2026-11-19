# Career onboarding contract — 17 November 2026

Web and mobile use `/candidate/profile/form` for shared fields and options.
Required fields retain their asterisk; optional labels no longer carry an optional suffix.

## Salary

`annual_salary` and `preferred_salary` remain whole annual amounts in major currency units.
Their companion fields are `annual_salary_currency` and `preferred_salary_currency`, each
`INR` or `USD`, defaulting to INR for existing data. An input of `75000` means 75,000
in the selected currency. Changing currency does not convert the amount. Explicit INR
lakh/crore shorthand remains supported in chat; unqualified numbers no longer imply lakhs.

Profile read-only displays, manual inputs, chat parsing and resume prefill carry the currency.
Salary and currency stay outside resume scoring and job matching; the resume builder does
not publish salary information. No exchange-rate integration is introduced.

## Employment

Employed experienced candidates supply current company, title, start month and notice period.
Experienced candidates who are not employed supply previous company, title, start and end
months. Their salary, industry, department and role describe their previous employment.
Selecting not employed preserves those facts and sets notice period to `IMMEDIATE`.
Freshers do not supply employment history and also receive immediate joining.
Completion enforces these requirements; incomplete drafts can still be saved.

Previous employment is included in manual resume generation and resume-builder prefill,
with an end date and without marking it current. Facts already discarded by older versions
cannot be reconstructed by this change and must be entered again.

## Database and deployment

Data lives in the existing `candidate_profiles.career.details` JSONB object; no separate
salary-currency column is necessary. Migration `0022_career_currency` backfills currency
metadata without changing existing amounts and normalises immediate joining for non-workers.
It preserves currency metadata on downgrade to avoid reinterpreting USD as INR.

This session applied the migration only to local Docker PostgreSQL at `127.0.0.1:5433`.
No AWS database was accessed or migrated. AWS requires a separate deployment and migration
using the target environment's migrator credentials. Local data does not synchronise to AWS.
