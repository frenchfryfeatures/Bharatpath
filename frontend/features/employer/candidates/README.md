# BharatPath Employer — Candidates UI

This feature reproduces the Candidates screen shown in the supplied BharatPath employer screenshots:

- Candidates list with 4 cards per page
- Best match / highest-score custom dropdown
- Search
- Score-band filters
- Skill pills
- Location filters
- Experience filters
- Completed add-ons filters
- Masked candidate names
- Score-band badges
- Unlock candidate flow
- Pagination
- Reusable `AppSelect`

## Files

- `app/employer/candidates/page.tsx`
- `features/employer/candidates/candidates-page.tsx`
- `features/employer/candidates/candidate-card.tsx`
- `features/employer/candidates/candidate-list-skeleton.tsx`
- `features/employer/candidates/candidate-filters.tsx`
- `features/employer/candidates/candidate-unlock-dialog.tsx`
- `features/employer/candidates/data.ts`
- `features/employer/candidates/types.ts`
- `components/ui/app-select.tsx`

## Integration

The supplied employer prototype already models Candidates as a first-class screen, including search, sorting, filters, pagination, candidate drawer and unlock state. This implementation separates that UI into reusable Next.js/React components.

If your existing `PortalShell` already wraps `/employer/candidates`, keep the route page as-is only if it is not already wrapped by the shell. Otherwise render `<CandidatesPage />` from your existing employer page component.

For production, replace the local `CANDIDATES` data and local credit value with your Redux/API selectors and dispatches.
