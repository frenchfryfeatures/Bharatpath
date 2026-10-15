# 18 — The resume builder

**For the web and mobile app teams, and the console team.** Added
2026-10-13. Module: `backend/app/modules/resume_builder/`.

A candidate who has no CV, or would rather not upload one, builds one: picks
one of four templates, edits a draft filled in from their CV (if one was
uploaded and read) and their onboarding answers, downloads it as a PDF and
uses it as their resume. **No AI is called here.** The first draft is the
CV as the review screen already shows it, with the answers in its gaps, and
the templates print exactly what is in the draft.

Read [04](04-resume-and-scoring-apis.md) first. A built resume becomes an
ordinary resume version, confirmed and scored the same way as an upload.

---

## 1. Where it sits in onboarding

```
sign up → name → onboarding questions (career profile)
        → "Upload a CV" or "Build my resume"        ← the new step
        → subscription (payment)
        → confirm the resume version → scored
```

- **Nothing here needs a subscription.** It is the step before payment.
- **Nothing here scores.** Using a built resume ("push") creates an
  *unconfirmed* version, exactly as an upload does. Scoring starts only when
  the candidate pays and confirms it with the existing
  `POST /candidate/resume/versions/{id}/confirm`.
- Choosing "Upload a CV" is unchanged: the existing upload flow.

## 2. The editor screen

Left: the form. Right: the preview. Suggested client behaviour:

1. On open, `GET /candidate/resume-builder/draft`. If `saved` is `false`,
   the content is a first draft (CV and onboarding answers, §4) and nothing
   is stored yet.
2. While the candidate edits, call `POST /candidate/resume-builder/preview`
   with the **current form state** about half a second after typing stops,
   and draw the returned pages. Unsaved content is fine. Do not call it on
   every keystroke: it is rate-limited to 60 a minute per person.
3. Autosave with `PUT /candidate/resume-builder/draft` (also debounced).
4. "Download": save first, then `POST /candidate/resume-builder/download`.
5. "Use this resume": save first, then `POST /candidate/resume-builder/push`,
   then go to the subscription screen with the returned `resume_version_id`.

## 3. Endpoints

All require a **candidate** token. Others get 403, no token 401.

| Method and path | What it does |
|---|---|
| `GET /candidate/resume-builder/templates` | The four layouts: `key`, `name`, `description`, `columns` |
| `GET /candidate/resume-builder/draft` | The saved draft, or a first draft from the CV and the onboarding answers (`saved: false`) |
| `PUT /candidate/resume-builder/draft` | Save (autosave). Body: `template_key`, `content` |
| `POST /candidate/resume-builder/draft/reset` | Start again from the CV and the onboarding answers, keeping the template |
| `POST /candidate/resume-builder/preview` | Draw a draft without saving it. Body: `template_key`, `content`, optional `format` (`png` default, or `svg`) |
| `POST /candidate/resume-builder/download` | The **saved** draft as `application/pdf`. Counted |
| `POST /candidate/resume-builder/push` | Use the saved draft as my resume: an unconfirmed `BUILDER` version with the PDF as its file |

### Templates

| `key` | Look |
|---|---|
| `classic` (default) | The LaTeX article look: Computer Modern serif, centred name, small-caps ruled headings |
| `modern` | Sans-serif, one blue accent, dates on the right, skills as chips |
| `sidebar` | Two columns: contact, skills, languages, certifications in a tinted strip |
| `minimal` | A quiet serif, no colour, headings in a narrow left column. Best for applicant tracking systems |

The designs are **placeholders of ours** (`TEMPLATES_VERSION` starts
`placeholder-`). Replacing them is a client decision.

### `content`: the same document as the review screen

`content` is **`StructuredResume`**, the object both apps already draw on the
resume review screen (`structured_resume` in [04](04-resume-and-scoring-apis.md)):

```json
{
  "full_name": "Priya Sharma",
  "headline": "Data Analyst",
  "location": "Pune",
  "summary": "Three years turning retail data into weekly dashboards.",
  "contacts": {"email": "priya@example.com", "phone": "+919876543210",
               "linkedin": "linkedin.com/in/priya", "others": [{"label": "Portfolio", "url": "priya.dev"}]},
  "experience": [{"job_title": "Data Analyst", "company": "Reliance Retail", "location": "Mumbai",
                  "start_date": "2022-07", "end_date": "", "is_current": true,
                  "description": "…", "highlights": ["…"], "skills_used": ["SQL"]}],
  "education": [{"qualification": "B.Com", "field_of_study": "Accounting",
                 "institution": "Fergusson College", "start_date": "2018", "end_date": "2021",
                 "grade": "8.4 CGPA"}],
  "skills": ["SQL", "Power BI"],
  "projects": [{"name": "…", "role": "…", "description": "…", "technologies": ["Python"], "url": "…"}],
  "certifications": [{"name": "…", "issuer": "…", "issue_date": "2022-03"}],
  "languages": [{"name": "Hindi", "proficiency": "Native"}],
  "achievements": ["…"],
  "interests": ["Chess"],
  "other_sections": [{"heading": "Volunteering", "items": ["…"]}]
}
```

Every field is optional, and an empty list hides its section. Section
headings on the PDF are in English.

**The first draft, for a candidate who uploaded a CV** (2026-10-15): the
CV's `structured_resume` -- the review screen's view, written when it was
read -- whole: every job, every qualification, summary, projects,
certifications, languages, achievements, interests, links. The answers then
fill what it leaves blank: name, headline and city come from the answers
first (the name is the one given at sign-up); email and phone only where the
CV has none; skills are the CV's plus the answers', one of each; jobs and
education from the answers only if the CV lists none. A personal-details
line the CV carried is dropped and a date a template cannot print is left
empty, so the first draft always saves. Only the **newest** CV is used, and
only its own chain: a CV read before 2026-10-06 has no structured view and
is not read again, so that candidate gets the answers-only draft below.

**Otherwise it fills in:** name (profile), email (account), phone, city,
headline (or desired role), skills, the current job if they are employed,
and their highest qualification. It **never** copies gender, salary, notice
period or preferred locations. None of those belong on a resume.

**A draft already saved is not refilled.** A candidate who opened the
builder before 2026-10-15 has the answers-only draft stored; "Fill in from
my profile" (`POST …/draft/reset`) rebuilds it with the CV.

**Edits never write back to the onboarding answers.** "Fill in from my
profile" is `POST …/draft/reset`.

### What a draft is refused for (422)

| `code` | Why | `params` |
|---|---|---|
| `resume_builder_personal_detail` | `other_sections` or `interests` states a date of birth, age, gender, marital status, religion, caste, nationality or family members. The platform never records these, so they are refused rather than silently dropped | `fields`: paths such as `other_sections[0].items[1]` |
| `resume_builder_invalid_date` | A date that is not `YYYY`, `YYYY-MM` or empty, or an end before its start | `fields` |
| `resume_builder_too_long` | The draft is over 40,000 characters as JSON (a dense two-page CV is under 10,000) | `max_chars` |
| `resume_builder_incomplete` | (push only) No name, or no job, qualification or skill to score | `fields` |

Show the message next to the field the path names. Preview and save refuse
the same things, so the preview pane can show the error while the candidate
types.

### `preview` response

```json
{"pages": ["iVBORw0KGgo…"], "mime": "image/png", "page_count": 1}
```

Base64, one per page (at most 10), A4 at 110 dpi (909 × 1286 px). Draw each
as `data:image/png;base64,<page>`. The same format as
`GET /candidate/profile/resume/preview`.

### `download`

`200 application/pdf` with `Content-Disposition: attachment;
filename="Priya-Sharma-Resume.pdf"`. Web: fetch as a blob and save it.
Mobile: write the bytes to a file and open the share sheet. `404
resume_builder_draft_missing` means nothing is saved yet.

**Every download is recorded** (`download_count`, `first_downloaded_at`,
`last_downloaded_at` on the draft). That is what the console's follow-up
list reads (§5).

### `push` response

```json
{"resume_version_id": "…", "resume_file_id": "…", "created": true, "confirmed": false}
```

- A new resume version with `source: "BUILDER"`. Its file is the PDF, so the
  existing `…/versions/{id}/document` and `…/preview` show it, and an
  employer who opens the candidate later receives exactly that PDF.
- The career profile's `resume_version_id` now points at it. The onboarding
  answers are untouched.
- Pushing an **unchanged** draft again returns the same version with
  `created: false`. `pushed_is_current` on the draft says whether it has
  changed since the last push.
- **A built resume is edited in the builder, never on the review screen.**
  `POST /candidate/resume/versions/{id}/edit` on a `BUILDER` version answers
  `409 resume_version_built`. Edit the draft and push again: that writes a
  new version and a new PDF together.

## 4. Scoring a built resume

The score is calculated exactly as for an upload: the confirmed version goes
through the same model reading. What the model reads is the draft as text
(roles, dates, descriptions, bullets, qualifications, skills, projects,
certifications, languages, achievements). **It never sees the name, contact
details, links, location or the year a qualification was completed.** The
score is never printed on the resume.

## 5. Console: the sales follow-up list

Two staff endpoints, capability `sales_leads`: **platform admin and support
agent**, exactly the roles that already see a whole phone number and email on
the candidate page. A test keeps the two equal.

| Method and path | What it returns |
|---|---|
| `GET /admin/leads` | Active candidates by follow-up stage, newest sign-up first, keyset-paged (`cursor`, `limit` ≤ 100). `stage` may be repeated. Default: every stage before paying |
| `GET /admin/leads/summary` | How many active candidates are at each stage |

**Stages**, computed on every read (the first that holds wins):

| `stage` | Meaning |
|---|---|
| `PAID` | Has a candidate subscription (lapsed included: they paid) |
| `COLLEGE_SEAT` | Has access through a college seat |
| `RESUME_DOWNLOADED` | Downloaded a built resume, has not paid. **The main sales list** |
| `PROFILE_COMPLETE` | Finished the onboarding questions, no download |
| `SIGNED_UP` | An account and nothing else |

"Signed up but no download" is `stage=SIGNED_UP&stage=PROFILE_COMPLETE`.

Each row: `id`, `full_name`, `email` and `phone` (**unmasked**, because the
list exists for calling), `locale` (call them in it), `city`,
`signed_up_at`, `stage`, `profile_completed`, `has_uploaded_resume`,
`resume_builder` {`template_key`, `first_downloaded_at`,
`last_downloaded_at`, `download_count`, `pushed_at`}, and
`contact_suppressed`: staff already stopped contacting this person (a
bounce, a complaint, a request to support), so leave them alone.

**Every page is an audit row** (`ADMIN_BYPASS_SESSION_OPENED`, metadata
`{"view": "leads", "stages": [...]}`), written before anything is read. No
score, CV or photo is in the list.
