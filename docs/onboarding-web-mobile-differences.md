# Candidate onboarding: web/mobile comparison

Reviewed 17 November 2026. Scope: candidate basic details, employment, education,
preferences, manual and conversational flows, request cleaning, and backend completion.
This is a source-code and regression-test audit, not a physical-device walkthrough.

## Fixed in this update

| Rule | Finding | Result |
|---|---|---|
| Employment end month | Both parsers allowed equality. Web wording said “after”; mobile wording allowed “same as”. Native manual validation also allowed equality. | Both now require end > start, with the same friendly message. Editing a start month in chat also checks an existing end month. |
| Annual salary | Web form locally required salary through `isProfileSalary`; mobile shared required-field logic did not. Backend completion did not require it. | Required in manual and chat onboarding on both clients for experienced candidates, including previous employment. Backend completion also requires it. Freshers exempt. |
| Invalid dates on save | Mobile cleaning could erase an invalid end month instead of explaining its ordering. | Native manual validation catches ordering before cleaning. Backend also refuses an invalid ordering on save. Existing same-month historical records can still be read. |

Salary remains optional in incomplete backend drafts; completing the profile requires
an explicit amount. Zero is an explicit amount rather than a missing answer. Neither
salary currency nor salary amount units changed. No schema migration is needed.

## Differences found in the initial audit (addressed in the follow-up)

| Priority | Area | Web | Mobile | Impact / recommended follow-up |
|---|---|---|---|---|
| High | Graduation-year window | Manual picker permits start year + 5. Chat parser permits + 7. | Manual and chat use start year + 7. | The same education can be accepted on mobile and blocked by the web picker. Choose one duration and use it in all pickers/parsers/backend. |
| High | Imported skills on save | Preserves existing skills and supplies a fallback if empty. | `careerDetailsForSave` deletes `key_skills`; completed submission then supplies Fresher/General if empty. | Parsed skills can be replaced on mobile. Preserve existing skills consistently. |
| High | Optional questions in chat | Builds the question list from visible section fields and lets the user skip optional answers. | Filters non-preference questions to required fields plus salary and experience exceptions. | Optional taxonomy questions can appear on web but be skipped entirely in mobile chat. Use one explicit question-inclusion policy. |
| Medium | Preferred salary | Web's form wrapper marks all profile-salary fields required, including preferred salary. | Preferred salary is optional under the shared required-field helper. | A profile can advance without a preference on mobile but fail on web. Agree whether this preference is required; annual salary is now aligned separately. |
| Medium | Chat date input | Accepts YYYY-MM. | Also accepts month names and alternate numeric date formats, normalizing to YYYY-MM. | Acceptance differs even though stored values match. This can remain a deliberate convenience if documented. |
| Medium | Phone/city normalization | Web chat phone parser requires an international number; city text reaches backend validation without the mobile-specific city parser. | Chat normalizes phone input and validates city characters locally; request cleaning can clear malformed values. | Timing and wording of errors differ. Prefer consistent validation before save rather than silently clearing answers. |

## Rules already aligned in the inspected helpers

- Previous company/title/start/end are retained for experienced, currently unemployed candidates.
- Unemployed candidates and freshers use Immediate Joining; employed candidates require notice period.
- Annual and preferred salary currencies use INR/USD with the same stored amount units.
- Taxonomy choices store IDs and label snapshots; changing a parent resets descendants.
- Verified email is read-only; sign-out is available during verified onboarding.
- Both parsers reject future employment dates; experienced candidates need non-zero total experience.

The follow-up implements these recommendations: seven-year graduation windows,
retained imported mobile skills, optional chat questions on both platforms, optional
preferred salary, matching phone/city validation before save, and flexible chat month
parsing on web as well as mobile. Invalid city and phone entries remain in the form
with an actionable error instead of being silently cleared by the mobile cleaner.

The backend now publishes `rules` on each `/candidate/profile/form` field, including
`required_when`, `visible_when`, and `education_max_years`. Both clients consume these
rules; completion checks use the same backend policy. Older backends remain supported
through client defaults. Server save validation enforces the education window while
historical profile reads remain available. No schema or AWS changes are required.

No new parity tests were added, as requested. Validation used TypeScript checks and
existing backend regression checks.

## Source references

- Web: `frontend/features/student/profile/career-api.ts`, `career-form.tsx`,
  `conversation-validation.ts`, and `frontend/features/student/salary.ts`.
- Mobile: `mobile-app/services/api/career.ts`,
  `mobile-app/screens/profile/CareerDetailsScreen.tsx`, and
  `mobile-app/screens/onboarding/conversationValidation.ts`.
- Backend: `backend/app/modules/candidate/career.py` and `career_service.py`.

Regression coverage includes salary requiredness for current/previous employment,
fresher exemption, earlier/equal/later end months, changing the starting month, and
backend completion/date-ordering policies.
