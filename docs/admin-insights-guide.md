# Admin guide: Insights Config

Open **Insights Config** in the admin sidebar. Only PLATFORM_ADMIN can see or use it; the API enforces the same capability.

1. Set rollout from 0–100%. The same candidate remains in the same deterministic rollout bucket. 0 disables the experience for everyone.
2. Switch Views, Search, Actions, Applications and Strength independently. Switches affect candidate visibility; retained event tracking continues under its bounded policy.
3. Adjust supported strength rules: enabled, weight, order, next-step label and benefit. Write factual usefulness text, not an unmeasured promise. Employment is automatically excluded for freshers. Keep at least one rule enabled when Strength is on.
4. Save. Every save creates a config version and an audit entry. If another administrator saved first, reload and reapply the change; the API returns 409 instead of overwriting them.
5. Review Tracked event volumes and pending counts. The page refreshes volumes every minute. Persistent pending events indicate the worker/Beat process should be checked. Counts show retained unique events, not every low-level audit row.

Rules do not change resume scores or recruiter hiring decisions. A 7/30-day candidate comparison never shows a percentage when the preceding count was zero. Existing historic gaps are explained instead of filled with estimates.

Deploy the two migrations, restart API/workers and run exactly one Beat process. See [Profile Insights](profile-insights.md) for API contracts, tracking coverage, retention and privacy follow-ups.
