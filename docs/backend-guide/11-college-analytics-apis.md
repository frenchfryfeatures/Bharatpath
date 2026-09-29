# 11 — College analytics: what a college gets to see about its cohort

Read [10-college-apis.md](10-college-apis.md) first — analytics is the
number-only companion to that doc's `GET /college/students`: same
`ROSTER`-consent population, same payment gate, but **nothing here ever
names a person**. Two endpoints, module `analytics`, prefix
`/college/analytics`.

---

## 0. The big picture — a dashboard, not a directory

A college's students who granted `ROSTER` consent (§10) let their college
**count** them — "our average score is X," never "Ramesh scored X."
Analytics is where that counting happens, and the entire module exists to
answer one question honestly: *what can a college be shown about a group of
consenting students without it amounting to seeing one of them by name?*

```
Student grants ROSTER consent (10-college-apis.md)
              │
              ▼
   counted in the college's cohort
              │
   ┌──────────┴──────────┐
   ▼                      ▼
GET .../overview     GET .../placements
(score distribution,  (hires confirmed on
 median, funnel        BharatPath, by month
 counts)               and location)
```

Three rules keep every number on both endpoints safe to sit beside a
roster a college already holds (where it can see exactly who said yes):

1. **A cohort floor.** Fewer than `min_cohort_size` (10 by default)
   students currently connected → nothing is shown but the raw count. A
   median of three people is one of those three people's score, thinly
   disguised.
2. **Small-cell suppression, with a complement.** A band or a month with
   fewer than `min_cell_size` (5 by default) students is withheld as `null`
   — and if *exactly one* cell was withheld, a second one is withheld with
   it, because "total minus every other cell" would otherwise hand back the
   one that was supposed to be hidden. A cell that's genuinely `0` is shown
   as `0` — that names nobody.
3. **Coarse values.** The median is rounded to the nearest `median_step`
   (10 by default); a job location is only ever named once enough hires
   share it — everything else is pooled into `"OTHER"`.

**These floors are `analytics.privacy` config, read live, never the
client's numbers by default — ours** (`DEFAULT_FLOORS` in
`analytics/domain.py`: cohort 10, cell 5, median-step 10). A bad config row
is a `500`, deliberately, rather than silently falling back to a smaller,
less safe floor — see [01-architecture.md](01-architecture.md)'s note on
strict config readers. A row may only ever **raise** a floor above the
code default, never drop it below `min_cohort_size: 5` / `min_cell_size: 3`
— those two numbers are hard-coded lower bounds a typo cannot cross.

**Read live, cached nowhere.** Both queries join the college's *current*
`ROSTER` consent at read time — a student who revokes consent a second
before the request stops being counted, on that very request, not on some
later cache expiry.

**Nothing here is audited.** Unlike `GET /college/students/{id}` (§10 —
which shows one named person and therefore writes an audit row every time),
an aggregate over the cohort floor doesn't reveal anyone, so there's no
audit trail to write. The line between "aggregate" and "reveal" is exactly
that floor.

---

## 1. Auth and payment — identical on both endpoints

**Auth required:** `COLLEGE_ADMIN` or `COLLEGE_STAFF` (SRS 1.16 names both —
unlike some other college actions, staff aren't shut out here), **plus an
active subscription** (R13 — analytics is what a college is paying for),
**plus a per-organisation rate limit** (`analytics.read`) — deliberately
per-organisation rather than per staff member, because a dashboard left
open in one browser tab, refreshing, is the thing being bounded, not any
one person's request rate.

A lapsed subscription → `402 subscription_required` on either endpoint,
same as every other paid college surface.

---

## 2. `GET /college/analytics/overview` — cohort snapshot

**Request:** no body, no query params.

**Response once the cohort is at or above the floor** — `200 OK`
(`CohortOverviewResponse`):
```json
{
  "connected_students": 340,
  "individually_visible": 52,
  "min_cohort_size": 10,
  "below_floor": false,
  "scored_students": 298,
  "score_distribution": { "ENTRY": 40, "DEVELOPING": 90, "SOLID": null, "STRONG": null },
  "median_score": 810,
  "applicants": 210,
  "applications": 340,
  "interviews": 55,
  "platform_hires": 12
}
```
| Field | Meaning |
|---|---|
| `connected_students` | Everyone with a **live** `ROSTER` (or `INDIVIDUAL`, which implies `ROSTER`) link right now. |
| `individually_visible` | Of those, how many *additionally* granted `INDIVIDUAL` — the college doesn't get to see *which* ones from this response, only the count. |
| `score_distribution` | Students per band. Two bands are `null` here because each held fewer than `min_cell_size` (5) — and because that left exactly *one* cell suppressed by count alone, a second smallest one was withheld too, so `SOLID` + `STRONG` together can't be inferred from `340 - 40 - 90`. |
| `median_score` | The **display** score's median (`display_value`, same floor everywhere else in the product), rounded to the nearest `median_step`. `null` whenever the distribution is. |
| `applicants` / `applications` / `interviews` / `platform_hires` | Funnel counts over the same cohort — how many of these students have ever applied to anything, how many total applications, how many reached an interview stage, how many were hired **and confirmed on BharatPath specifically** (see §3 for why that qualifier matters). |

**Response when the cohort is under the floor** — still `200 OK`, not an
error, because "too few students to report on safely" is a legitimate
state, not a failure:
```json
{
  "connected_students": 6,
  "individually_visible": 1,
  "min_cohort_size": 10,
  "below_floor": true,
  "scored_students": null,
  "score_distribution": null,
  "median_score": null,
  "applicants": null,
  "applications": null,
  "interviews": null,
  "platform_hires": null
}
```
`below_floor: true` is the signal a dashboard is meant to render as "link a
few more students to unlock cohort insights" — **`connected_students` and
`individually_visible` are the only two figures ever shown below the
floor**, because they're not aggregates over sensitive data, they're just
"how many people said yes so far," which a college already knows from its
own roster.

**Score distribution itself has its own, separate threshold**: even once
the cohort passes `min_cohort_size` overall, `score_distribution` and
`median_score` stay `null` until at least `min_cohort_size` of those
students specifically have a *score* (not just a link) — a college with 50
linked students but only 4 who've confirmed a resume and been scored still
sees `null` for the score fields, non-`null` for the funnel counts.

---

## 3. `GET /college/analytics/placements` — hires, by month and location

**Request:** no body, no query params.

**Response** — `200 OK` (`PlacementReportResponse`):
```json
{
  "source": "PLATFORM",
  "min_cohort_size": 10,
  "below_floor": false,
  "total_hires": 18,
  "by_month": [
    { "month": "2025-10", "hires": 0 },
    { "month": "2025-11", "hires": null },
    { "month": "2025-12", "hires": 3 },
    "... 9 more entries, 12 total, oldest first, current month last"
  ],
  "by_location": [
    { "location": "Bangalore", "hires": 9 },
    { "location": "Pune", "hires": 6 },
    { "location": "OTHER", "hires": 3 }
  ]
}
```
| Field | Meaning |
|---|---|
| `source` | Always the literal `"PLATFORM"`. Every figure here is a hire **both sides confirmed inside BharatPath's own hiring pipeline** ([06](06-applications-pipeline-apis.md)'s `HIRED` stage) — a placement a student got some other way is never counted, never estimated, and never blended in. The field exists specifically so a client rendering this can't accidentally caption it as the college's *total* placement rate. |
| `by_month` | Always exactly the last 12 calendar months (India time), oldest first, current month last — **even months with zero hires appear**, with `hires: 0`, so the array's length is a fixed 12 regardless of activity. A month is `null` instead of `0` only when it had *some* hires but fewer than `min_cell_size` — a real `0` and a suppressed small number look different on purpose. |
| `by_location` | As the employer typed the job's location, title-cased and whitespace-collapsed for grouping — **only shown by name once at least `min_cell_size` hires share it**; everything short of that is pooled into `"OTHER"`, appended last, only when something was actually pooled into it. Sorted by hire count, descending. |

**Below the cohort floor:** same shape as the overview — `below_floor:
true`, `total_hires: null`, `by_month` still has all 12 months but every
entry is `{ "month": "...", "hires": null }`, `by_location` is `[]`.

## 4. `GET /college/analytics/applications` — where the cohort's applications stand

Added 2026-09-29, beside the per-student stages in
[10](10-college-apis.md). **Response** — `200 OK`:
```json
{ "min_cohort_size": 10, "below_floor": false, "total_applications": 19,
  "by_stage": { "SUBMITTED": 12, "VIEWED": 0, "SHORTLISTED": 0, "INTERVIEW": 0,
                "DECISION": 0, "HIRED": null, "REJECTED": null, "WITHDRAWN": 0, "EXPIRED": 0 },
  "reached": { "SHORTLISTED": 7, "INTERVIEW": 7, "DECISION": null, "HIRED": null } }
```
`by_stage` is where each application is now; `reached` counts applications
that were *ever* at each milestone, wherever they are now (one rejected after
an interview still reached one). **Every rule of this doc applies:** nothing
below the cohort floor (everything `null`), and a small cell is withheld
with a partner — above, the single hire is `null` and so is `REJECTED`,
because otherwise the total would give the hire back. The database function
behind it returns one row per application with nothing saying whose.

---

## Quick reference

| Question | Answer |
|---|---|
| Can a college ever see one named student's score from this doc? | No — that's `GET /college/students/{id}` in [10-college-apis.md](10-college-apis.md), a different, audited endpoint behind `INDIVIDUAL` consent. |
| Does revoking consent affect these numbers? | Immediately — both queries join live consent, nothing is cached. |
| Is a placement made outside BharatPath ever counted here? | Never. `source: "PLATFORM"` is a promise, not a label. |
| What decides the floors? | `config_values` key `analytics.privacy`, read live; `DEFAULT_FLOORS` (10 / 5 / 10) if no row exists. A malformed row is a `500`, not a silent fallback to something less safe. |
