# 12 — Engagement streaks: daily check-ins, and why they can never touch the score

Three endpoints, module `engagement`, prefix `/candidate/streak`. This is
the smallest module in the whole product, and the one whose entire design
is organised around a single rule: **these points are not the score, and
there is no path — accidental or otherwise — by which they could become
it.** Read [04-resume-and-scoring-apis.md](04-resume-and-scoring-apis.md)
first if you haven't; this doc leans on "what the score is" to explain what
this deliberately is *not*.

---

## 0. The big picture — a separate, small, capped balance

```
Candidate opens the app
        │
        ▼
POST /candidate/streak/me/check-in     (client calls this on every app open)
        │
   first call today?
   ├─ yes → count it: extend or start the streak,
   │        apply a break penalty if a day was missed,
   │        award a milestone if one was just reached
   └─ no  → nothing changes, same response either way
        │
        ▼
GET /candidate/streak/me               (read the current state, any time)
GET /candidate/streak/me/points        (the ledger — every change, newest first)
```

**Why this exists at all:** to reward opening the app regularly, the way a
habit-tracking feature does in almost any consumer product. **Why it's kept
so rigidly separate from the 700–990 score:** the score is defined by a
fixed formula (700 base + up to 200 + 30 + 60, from ordinary, versioned,
*replayable* code reading a resume) and by invariants that a re-computation
must always reproduce exactly. A streak has none of those properties — "did
you open the app today" isn't something a score replay could ever
reconstruct from stored resume data, a missed day would need to *subtract*
from a score that a resume-based invariant says must never fall below 700,
and a long enough streak's milestones would need to push it past its 990
ceiling. Mixing the two wouldn't just be untidy, it would break three
separate invariants (1, 2, 3) and 4′ (add-ons can't award their own points)
simultaneously. So instead:

- **Streak points live in their own balance**, `points_balance`, never
  named `score` or `value` anywhere in this module's schemas — enforced by
  a dedicated invariant test (`test_streak_never_moves_the_score.py`) that
  reads this module's field names directly.
- **`engagement` and `scoring` cannot import each other**, in either
  direction — an import-linter contract, not just a convention. Neither
  module's code is *capable* of reaching into the other's numbers, by
  construction.
- **No employer-facing schema anywhere in the codebase may reference
  engagement at all.** A streak is a candidate's own private habit-tracking
  number; an employer never sees it, on a masked card, a reveal, or
  anywhere else.

**Not paywalled, for now, by a specific, documented decision** — if a
lapsed subscriber couldn't check in, they'd lose their whole streak for
*not paying* rather than for *not opening the app*, which is the wrong
punishment for the wrong thing. (`docs/streaks.md` §7 records this as a
decision the client can revisit, not an oversight.)

---

## 1. The calendar day is the server's, never the client's

Every check-in is dated by **the server's own clock, converted to India
Standard Time** — the request carries no date field at all, anywhere in its
schema. This is deliberate, not an accident of not needing one: if a client
could report which day a check-in was "for," a streak could be kept alive
forever by always sending yesterday's date. IST is used as a fixed
+05:30 offset (not a tz-database lookup) because India has kept one offset
since 1945 — there's no DST transition to get wrong, and it sidesteps a
Windows-specific dependency the tz-database approach would need.

---

## 2. `GET /candidate/streak/me` — read the current state

**Auth required:** `CANDIDATE` role. **Request:** no body.

**Response** — `200 OK` (`StreakResponse`):
```json
{
  "status": "AT_RISK",
  "current_streak": 12,
  "longest_streak": 40,
  "last_active_on": "2026-09-22",
  "today": "2026-09-23",
  "points_balance": 55,
  "next_milestone": { "days": 30, "points": 10 },
  "milestones": [
    { "days": 30, "points": 10 },
    { "days": 90, "points": 15 },
    { "days": 365, "points": 20 }
  ],
  "break_penalty": 10,
  "rules_version": "default-v1-2026-09-13"
}
```
| Field | Meaning |
|---|---|
| `status` | `NONE` — never checked in. `ACTIVE_TODAY` — today already counted. `AT_RISK` — counted yesterday, still savable by opening the app today. `BROKEN` — a day was missed. |
| `current_streak` | **Already shows `0` under `BROKEN`, before the next check-in ever runs.** A break is applied to the ledger only at the next check-in (§3), but it's *shown* immediately — someone who hasn't opened the app in three days sees `0` here, not a stale `12` that only updates once they return. |
| `points_balance` | The engagement-points balance. Never goes negative — floored at `0` by both the domain logic and a database `CHECK` constraint, so a break penalty larger than the remaining balance just zeroes it rather than going negative. |
| `next_milestone` | The next `{days, points}` this streak would reach if it kept going uninterrupted from `current_streak`. `null` once every milestone in the table has already been reached in this run. |
| `milestones` | The full table currently in force — not fixed in code, see §4. |
| `rules_version` | Which version of the rules produced these numbers — so a candidate who reached a milestone under one set of numbers and later sees the table change can tell the two apart. |

This is a pure read — calling it never counts today, no matter how many
times it's called. Only `POST .../check-in` does that.

---

## 3. `POST /candidate/streak/me/check-in` — record that the app was opened

**Auth required:** `CANDIDATE` role. **Request:** no body. Meant to be
called on every app open or foreground event — **idempotent by calendar
day**, so calling it five times in one day is exactly as safe as calling it
once.

**Response** — `200 OK`, not `201` (`StreakCheckInResponse`):
```json
{
  "counted": true,
  "streak": { "...": "the same shape as GET /me, already reflecting this check-in" },
  "changes": [
    { "kind": "STREAK_BREAK_PENALTY", "points": -10, "balance_after": 45, "streak_length": 12, "milestone_days": null, "activity_on": "2026-09-23", "created_at": "2026-09-23T09:00:00Z" }
  ]
}
```
| Field | Meaning |
|---|---|
| `counted` | `true` only on the **first** call of the calendar day. Every later call that same day returns `false`, with `changes: []` and `streak` unchanged — nothing about the request is wrong, there's just nothing left to do. |
| `changes` | What this specific check-in did to the balance, in order. Can be empty (an ordinary continuing day, no break, no milestone just reached), hold one entry, or — reaching a milestone on the very day a streak resumes — **both** a `STREAK_BREAK_PENALTY` and a `MILESTONE_AWARD` in the same response. |

**What decides what happens, in order, when a check-in lands:**
1. **Already counted today?** Nothing changes; `counted: false`.
2. **Continuing from yesterday** (`last_active_on` was exactly
   yesterday)? The streak extends by one day. No penalty, no special event
   unless the new length happens to land exactly on a milestone.
3. **Any longer gap, with a streak to lose?** The streak breaks: a
   `STREAK_BREAK_PENALTY` is applied **once**, regardless of how many days
   were actually missed (missing 2 days costs the same as missing 20), then
   today starts a fresh streak of `1`.
4. **First check-in ever?** A streak of `1`, no penalty — there was nothing
   to break yet.
5. **A milestone is awarded whenever the streak's new length exactly
   matches one** in the table — so each milestone is earned once per
   unbroken run, and can be earned again after a later break and a fresh
   climb back up to that same length.

**A clock correction never counts as a break:** if `today` somehow arrives
*earlier* than the last recorded active day (a clock skew, a retried
request racing another), the check-in is silently ignored rather than
treated as "missed every day since." Punishing a candidate for the server's
own clock moving backward would be exactly backward.

**`points` in a `changes` entry is signed** — negative for a deduction,
positive for an award — so a client can render a ledger without special-
casing which direction each entry goes.

---

## 4. `GET /candidate/streak/me/points` — the points ledger

**Auth required:** `CANDIDATE` role. **Request:** query param `limit`
(default `50`, `1`–`200`). No cursor — this is a short, personal ledger, not
a table expected to grow into the thousands.

**Response** — `200 OK`, an array of `StreakPointsChangeResponse`, newest
first:
```json
[
  { "kind": "MILESTONE_AWARD", "points": 10, "balance_after": 55, "streak_length": 30, "milestone_days": 30, "activity_on": "2026-09-20", "created_at": "2026-09-20T08:30:00Z" },
  { "kind": "STREAK_BREAK_PENALTY", "points": -10, "balance_after": 45, "streak_length": 12, "milestone_days": null, "activity_on": "2026-09-10", "created_at": "2026-09-10T09:00:00Z" }
]
```
Every entry ever written to `changes` (§3) across every past check-in,
never trimmed or summarised — this is a durable ledger, not a rolling
window. `kind` is one of `STREAK_BREAK_PENALTY` or `MILESTONE_AWARD` — the
only two things that ever move the balance.

---

## 4b. `GET /candidate/streak/me/calendar` — which days the app was opened

**Auth required:** `CANDIDATE` role. Read-only: it never counts today as a
visit (only `check-in` does).

**Request** — query parameters, all optional:

| Param | Meaning |
|---|---|
| `period` | `week` (Monday to Sunday), `month`, or `year` (the 366 days ending on `date`). Defaults to this week when neither a period nor a range is given. |
| `date` | The day the period is around. Defaults to today (IST). |
| `from`, `to` | An explicit range instead of a period, both ends inclusive. |

At most **366 days** at once. `422 streak_calendar_range_invalid`, with
`params.reason`, for: a range and a period together, only one of
`from`/`to`, `from` after `to`, more than 366 days, or a `date` out of range.

**Response** — `200 OK` (`StreakCalendarResponse`):
```json
{
  "start": "2026-10-12",
  "end": "2026-10-18",
  "today": "2026-10-13",
  "days": [
    { "date": "2026-10-12", "status": "ACTIVE", "milestone_days": null },
    { "date": "2026-10-13", "status": "TODAY_PENDING", "milestone_days": null },
    { "date": "2026-10-14", "status": "UPCOMING", "milestone_days": null }
  ],
  "active_days": 1,
  "missed_days": 0,
  "longest_run": 1
}
```
| `status` | Meaning |
|---|---|
| `ACTIVE` | The app was opened that day. `milestone_days` is set when a milestone was reached that day. |
| `MISSED` | A past day it was not opened. |
| `TODAY_PENDING` | Today, not opened yet: not missed, the day is not over. |
| `UPCOMING` | A future day. |
| `BEFORE_START` | Before the first day ever counted. Never `MISSED`. |
| `NOT_RETAINED` | Older than a year. Opened days are kept for one year (client decision). |

**Opened or not, never how often**: there is no count of opens per day,
by design. `longest_run` is the longest run of `ACTIVE` days *inside the
range*, which is not the streak (a streak can start before the range does).

---

## 5. Where the numbers themselves come from

**The rules are data, not code.** `break_penalty` (default `10`) and the
milestone table (default `30 → 10`, `90 → 15`, `365 → 20` points) live in a
`config_values` row under key `engagement.streak_rules`, read live on every
call. No row yet → the shipped defaults above apply, tagged
`rules_version: "default-v1-2026-09-13"`. A new row is a **new version**,
never an edit to an existing one — the same "config is versioned rows, not
mutated numbers" pattern as every other configurable surface in this
product (see [01-architecture.md](01-architecture.md) and the root
`CLAUDE.md`'s note on `seed_config.py`).

**A malformed rules row is a `500`, not a silent fallback** — same
reasoning as every other strict config reader in this codebase: quietly
falling back to the code default would make a broken config change look
like it had taken effect when it hadn't, and a candidate's balance is real
money-adjacent state (redeemable points), not a cosmetic number worth
guessing about.

---

## Quick reference

| Question | Answer |
|---|---|
| Can these points ever raise or lower the 700–990 score? | No — structurally impossible; enforced by an import-linter contract and an invariant test on this module's own schemas. |
| Does an employer ever see a candidate's streak or points? | Never — no employer-facing schema in the codebase may reference this module. |
| Is check-in paywalled? | No, by deliberate decision — losing a streak for not paying would punish the wrong thing. |
| What decides "today"? | The server's clock, converted to IST. The client never states a date. |
| Can a check-in be replayed to farm points? | No — idempotent by calendar day; a second call the same day changes nothing. |
