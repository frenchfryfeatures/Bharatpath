# 17 — The job-search assistant (chat)

**For the candidate app team.** One endpoint, `POST /candidate/assistant/messages`,
added 2026-10-13. A candidate chats in their own words, in any language the
model reads (English, Hindi, Hinglish, the other app languages). The
assistant finds jobs, opens one, offers to apply, and reports where
applications stand. Module: `backend/app/modules/assistant/`.

Read [05](05-jobs-and-discovery-apis.md) (the board) and
[06](06-applications-pipeline-apis.md) (applying) first. Every card the chat
returns is a schema those screens already draw.

---

## 1. How it works, in one paragraph

The model reads the candidate's message and picks **one action** from a fixed
list, plus the words to say. The server then carries out the action itself,
using the same code as the board, the home screen's recommendations and the
Application Board, with the same rules. **The model never applies, never
sees the candidate's score or a job's threshold, and never sees their name,
contact details, CV or profile.** Applying is a button the candidate taps,
and that button calls the ordinary apply endpoint.

## 2. The request

```http
POST /api/v1/candidate/assistant/messages
Authorization: Bearer <candidate token>
Content-Type: application/json

{
  "message": "data analyst jobs in Pune, I'm a fresher",
  "history": [
    {"role": "user", "text": "hi"},
    {"role": "assistant", "text": "Hi! What kind of job are you looking for?"}
  ],
  "state": "eyJqIjpbXSwidiI6MX0"
}
```

| Field | Rules |
|---|---|
| `message` | 1–1000 characters. |
| `history` | **Optional.** Up to 12 turns, oldest first, each `role` `user` or `assistant` and `text` ≤ 2000 characters. Send what you drew: the candidate's messages and the `reply` texts. The server keeps the newest ~6000 characters. |
| `state` | **Optional.** The `state` from the previous reply, **unchanged**. Leave it out (and `history` empty) to start a new conversation. |

**Nothing is stored on the server.** The conversation lives in the app. If
the app is closed and reopened, either restore the last `history` and
`state` from local storage or start fresh. Both work.

## 3. The reply

```json
{
  "reply": "Here are some data analyst roles in Pune that suit a fresher.",
  "action": "SEARCH",
  "jobs": [ /* RecommendedJob, up to 5, best match first */ ],
  "has_more": true,
  "job": null,
  "apply": null,
  "applications": [],
  "suggestions": ["Show more", "Only remote jobs", "Apply to the first one"],
  "state": "eyJqIjpbIjBmM..."
}
```

Draw, in order: `reply` as the assistant's bubble, then whichever cards are
present, then `suggestions` as tappable chips. Tapping a chip sends its text
as the next `message`. **Always keep the new `state`** for the next message.

| `action` | What comes with it |
|---|---|
| `SEARCH`, `MATCH_MY_PROFILE`, `SIMILAR_TO_APPLIED`, `MORE_RESULTS` | `jobs`: a list of `RecommendedJob` (the home-screen card: `eligibility`, `matched_skills`, logo, salary). `has_more` says whether "show more" will find more. These jobs are now "in view", numbered 1–5 in this order. |
| `SHOW_JOB` | `job`: a full `BoardJobDetail`, the same object as `GET /candidate/jobs/{id}`. |
| `APPLY` | `job` as above, and `apply` (below) **only if the candidate may apply**. |
| `MY_APPLICATIONS` | `applications`: up to 5 `ApplicationResponse`, newest first, as on the Application Board. |
| `REPLY` | Words only: a greeting, advice, or a clarifying question. |

An empty list (nothing found) is still a 200: `jobs: []` with a `reply`
that says so. In that case the jobs in view and `state` stay as they were.

### Jobs in view

"Apply to the second one" and "tell me more about the Infosys one" refer to
the jobs from the **last list** the chat showed. Draw a small number (1–5)
on each card so the candidate can say it. A job that has since been paused
or closed drops out of view silently, so its numbers shift up.

## 4. Applying through the chat

```json
"apply": {
  "job_id": "0b6c…",
  "job_title": "Junior Data Analyst",
  "employer_name": "Acme Analytics Pvt Ltd",
  "in_app": true
}
```

- **`in_app: true`**: show a **Confirm** button. On tap, call
  `POST /candidate/applications` with `{"job_id": apply.job_id}`, exactly as
  the job screen's Apply button does, and handle its answers the same way
  (201 new, 200 already applied, 409 `score_pending` /
  `application_unavailable`, 403 `eligibility_below_threshold`). Then add a
  local "Applied ✓" line to the chat. No message to the assistant is needed.
- **`in_app: false`**: the employer takes applications elsewhere. Show
  **Open job** instead, which opens the job screen with its external link.
- **`apply: null` on an `APPLY` reply**: the job is not open to this
  candidate right now (`job.eligibility` says which: `BELOW_THRESHOLD` or
  `SCORE_PENDING`). Show no button. The `reply` already explains, without
  any number.

The assistant **never** applies on its own. A message, or a job description
written to trick the model, can at most make a Confirm button appear. The
candidate's tap is the application.

## 5. Errors

| Status | `code` | Meaning / what to do |
|---|---|---|
| 402 | `subscription_required` | Paywalled like the job board. Same upsell as the board. |
| 403 | `permission_denied` | Not a candidate token. |
| 422 | `assistant_state_invalid` | The `state` was edited or truncated. Drop it and resend without `state` (start over). |
| 422 | (FastAPI validation) | Message empty or over 1000 characters, or bad `history`. |
| 429 | `rate_limited` | 120 messages per hour per candidate. `params.retry_after_seconds`. |
| 503 | `assistant_unavailable` | The model could not answer. Nothing happened; offer "Try again" and resend the same request. |

## 6. What the assistant will and will not do

- **Finds jobs** by role words, skills, city, work mode (onsite, hybrid or
  remote), a minimum salary, the experience the candidate says they have,
  and "only jobs I can apply to". Searches cover BharatPath's own board only,
  never the wider internet.
- **Never shows jobs already applied to** in its lists. "My applications"
  covers those.
- **Never talks about the score.** Asked about it, the assistant points to
  the Score screen. It never says why a job is not open to someone.
- **Refuses to filter by age, gender, marital status, religion, caste,
  health or disability**, and says jobs here are open regardless.
- **Puts no links or email addresses in `reply`**: they are stripped.
  A job's real link is on its card.

## 7. Suggested screen

A chat screen reachable from the home screen and the job board ("Ask the job
assistant"), with starter chips the app draws itself before the first
message (the API has no welcome call), for example *"Jobs that suit my
profile"*, *"Remote jobs"*, *"Where are my applications?"*. Job cards in the
chat open the normal job screen on tap.

## 8. For backend developers

- `domain.py`: the closed action list, `parse_plan` (refuses anything that
  changes what happens, retried once with the reason, then 503), the state
  format, `scrub`. `PlanContext` and `JobInView` field lists are held by
  `tests/unit/test_assistant_domain.py`.
- `planner.py` / `openai_planner.py`: `ASSISTANT_PROVIDER` is `openai`
  (default, `ASSISTANT_MODEL_ID` pinned) or `stub` (tests and keyless local
  work, refused in staging and prod). The stub reads English keywords:
  `find python jobs in pune`, `more`, `show 2`, `apply 1`,
  `my applications`, `match my profile`, `similar`.
- `.importlinter` contract `assistant-never-imports-scoring`.
- What a candidate types goes to OpenAI with `store: false`, processed in
  the US (plan §13 N2, as for CVs). It is never logged; only the action and
  token counts are.
