# Profile Insights

Implemented for the candidate web portal and React Native app, with a profile summary link and an administrator-only Insights Config screen. This is separate from the resume score, resume editor and profile editor.

## Editor boundaries

Profile details retain section-level Edit controls and show every current profile field, using N/A for missing data. Individual field edit buttons were removed. Saving `PUT /candidate/profile/details` updates career facts and an optional owned resume association only. Completing a profile without a resume no longer creates a CV. Saving skills, education or employment never creates a resume revision or scores anything.

Every Resume review edit action opens the full resume builder with the selected version's document. Applying a built resume regenerates its PDF. Builder submission changes the profile's resume association, but leaves profile answers and completion unchanged. Initial onboarding import/prefill remains supported; it is not ongoing two-way synchronization.

## What is measured

- Profile views: one recruiter/candidate/India calendar day, across search-profile and successful application-profile opens. Existing search view logs are backfilled for the retained year. Failed or suppressed profile disclosures do not add a view.
- Search appearances: an issued, actor-scoped, 15-minute receipt is acknowledged only after the recruiter-facing web card is at least 50% visible for 500 ms in a visible browser tab. Matching a result or issuing a receipt never counts. Acknowledgements are idempotent, cannot be used by another recruiter, and recheck current visibility.
- Keywords: submitted matching skill/location filters and matched skill labels. Arbitrary free-form query strings are not retained. The current search supports skills and locations, not a separate job-title filter.
- Actions: successful saved-candidate, job invitation, pipeline shortlist and persisted message actions are recorded on the existing backend transactions. Completed browser file transfers and email/phone link openings report non-blocking client telemetry. A download counts a transferred file, not proof that the recipient retained it. Link opens do not claim an email was delivered or a call connected.
- Companies: only name, industry and city are exposed, with action totals. City is currently null because there is no dedicated employer-city field. The UI says City not provided. No recruiter name, user ID, email or phone is returned. The list displays the top 20 companies and explicitly indicates truncation.
- Application timelines: existing recorded stages, with no new pipeline stage. Applied uses the recorded application creation time. VIEWED uses proof from an actual application GET whose candidate profile was disclosed; general search opens and legacy inferred VIEWED transitions never fabricate that timeline entry. The current saved pipeline stage is still shown. Pages contain 20 applications and support Load more.
- Profile strength: weighted completeness of actual profile fields, name, resume existence and photo existence. Employment is not required for freshers. Default weights, enable switches, order, action labels and benefit text are editable by an admin. It makes no unmeasured promise of increased views and never modifies the resume score.

7/30-day windows use Asia/Kolkata calendar dates, today included. They compare the equally long preceding window. A zero previous count has no percentage. Historical action/search measurements were absent and are not invented; the screen explains this coverage limitation.

## APIs

All paths below are relative to `/api/v1` and require the existing authentication and role guards.

- `GET /candidate/insights?days=7|30`: candidate-owned summaries, strength, company and keyword lists, first application page, summary timestamp and metric flags.
- `GET /candidate/insights/applications?offset=0`: subsequent 20-application pages.
- `POST /employer/insights/impressions`: `{receipts:[uuid,...]}`, at most 100. Only the issuing recruiter's unexpired visible receipts are accepted; repeats return accepted=0.
- `POST /employer/insights/actions`: `{candidate_id,action,event_id,application_id?}`. Client actions are CV_DOWNLOAD, EMAIL_OPENED and CALL_OPENED. Existing discovery or job-context disclosure permissions are rechecked, including contact-role restrictions.
- `GET|PUT /admin/insights/config`: existing versioned `config_values`, key `profile.insights`, administrator capability `insights_config`. PUT requires the current version; concurrent edits return 409. Writes are audited.
- `GET /admin/insights/volumes`: retained event counts and pending summaries, without identities.

Event/receipt writes are small indexed database operations; no rendering, outbound HTTP or broker call is added to a recruiter action. Client telemetry failures do not block the action. As with any browser telemetry, network loss or unsupported IntersectionObserver can undercount; it never generates estimates to fill gaps. Older apps keep working because all existing API fields and paths remain compatible and the search receipt field is additive.

## Summaries, deployment and retention

Migrations `0026_profile_insights` and `0027_insights_privacy` add receipt/event tables, candidate/day aggregates, anonymous totals, RLS and the existing atomic erasure integration. Run migrations before deploying the updated API. Restart the API and Celery worker, then run the existing singleton Celery Beat process. Its new `insights.aggregate` task runs every minute, drains bounded batches and serializes summary/retention transactions. No page request recomputes raw-event totals.

Detailed Insights events and candidate-linked daily activity expire after 365 days. The retention task keeps only anonymous metric totals, without candidate, recruiter or company IDs. Unused search receipts expire after 15 minutes and are swept. The existing security/audit log retention is a separate platform policy and is not silently changed by this feature.

Account erasure removes Insights raw events, search receipts and daily activity in the same SECURITY DEFINER cascade and manifest as existing erasure. The candidate export includes their daily metrics, without recruiter identifiers. Mobile caches a last-loaded snapshot per backend/account/period for at most 24 hours of reuse and clears Insights cache keys on sign-out. A refresh keeps the visible snapshot while updating in the background.

Only local Docker PostgreSQL was migrated during development; no AWS deployment or database update was performed. A local-only `.local-services/run_insights_local.py` helper runs the same sweep every minute without disturbing existing local queue workers. Production uses the Celery schedule above.

Privacy design uses purpose-limited event fields, existing visibility rules, candidate-scoped reads, admin RBAC/audits, exports, erasure and bounded retention. The source for legal review is the [official MeitY DPDP Rules 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf). This implementation does not replace the platform's notice, consent, legal-basis or existing audit-retention review.

## Gaps and follow-up suggestions

- No dedicated employer-city field: show unavailable; do not infer city from statutory addresses.
- No WhatsApp contact action exists on current recruiter screens. No connected-call or delivered-external-email signal exists. Do not label link clicks as successful contact.
- Historical search appearances and recruiter action events cannot be reconstructed reliably. Tracking starts with the new release; existing proven profile-view logs and application stage records are reused.
- The candidate mobile app has no recruiter search surface. The employer web candidate list, search contact links, both resume-download components, pipeline shortlist, save/invite and application messaging are covered. Uninstrumented external clients still receive search results without fabricating appearance acknowledgements.
- Suggested separate privacy work: candidate discoverability/analytics choices, a documented employer/recruiter tracking notice, company-city collection, and a review of older taxonomy-submission retention. No new privacy controls were introduced.

## Validation

Backend tests cover receipt replay/theft/expiry/visibility, view deduplication, true application-context VIEWED, comparisons, weighted strength/config validation, admin edit conflicts, retention and idempotent summaries. Existing shortlist/message, scheduler and migration suites are exercised. Editor-separation regressions verify profile-only updates, no auto-created CV, owner-scoped associations and unchanged profile answers after resume edits. Web/mobile TypeScript checks, lint and Android/iOS exports pass. Responsive web and empty states were checked using an isolated, labelled in-memory UI fixture, which was removed afterwards. Physical device interaction remains a deployment smoke check.
