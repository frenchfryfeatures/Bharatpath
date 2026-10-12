# 16 — Profile photos & organisation logos: input/output reference

Added 2026-10-09. Two kinds of image, one module (`profile_images`):

| Image | Whose | Who sets it | Who sees it |
|---|---|---|---|
| **Profile photo** | Every signed-in person: student, employer member, college member, BharatPath staff | The person, for themselves | The person, and BharatPath staff (student photos appear on the admin console's full candidate page). **A student's photo is never shown to an employer or a college.** |
| **Organisation logo** | An employer or a college | Employer: the **owner**. College: the **college admin**. | Everyone shown the organisation's name: its members, candidates (jobs, applications, invitations, colleges), colleges (where students applied and were hired) and staff. See §4. |

**Why employers never see a student's photo:** a face shows gender, age and
more. Masked search exists so an employer judges on band and skills. Showing
photos would undo that, so it needs a client decision. A test
(`tests/invariants/test_profile_photo_reach.py`) fails the build if an
employer- or college-facing response grows a photo field.

None of these routes is paywalled.

---

## 0. Uploading is three calls — the same for photos and logos

```
1. POST …/upload              → { upload_id, url, max_bytes, accepted_types, expires_in_seconds }
2. PUT  <url>                 the file's raw bytes, straight to S3 (no auth header, no JSON)
3. POST …/confirm             { "upload_id": "…" }   → the image, ready to show
```

- **Accepted:** JPEG, PNG or WebP, up to 5 MB (`max_bytes`). The type is
  read from the file's bytes, not its name or Content-Type.
- **The server keeps its own copy, not yours.** At confirm the file is
  decoded, turned upright, scaled to at most **512 px** on its long side and
  re-encoded: **JPEG**, or **PNG** when it has transparency (a logo). All
  metadata is dropped, including the GPS position a phone writes into a photo.
- **Your uploaded file is always deleted**, whether it was accepted or not.
- **Uploading again replaces** the previous image, and the old one is deleted.
- Confirming the same `upload_id` twice returns the same image (safe to retry).

### Errors at confirm

| Status / `code` | `params.reason` | Meaning |
|---|---|---|
| `404 profile_image_upload_not_found` | — | Nothing was PUT under that `upload_id` *for you* (or the ticket expired) |
| `422 profile_image_rejected` | `empty` | Under 64 bytes |
| | `too_large` | Over 5 MB |
| | `unsupported_type` | Not JPEG/PNG/WebP (a GIF, a PDF, text…) |
| | `not_an_image` | Starts like an image but doesn't decode as one |
| | `too_many_pixels` | Decodes to over 40 megapixels |

### Showing an image

Every read returns `ImageResponse`:
```json
{ "url": "https://…presigned…", "mime": "image/jpeg", "width": 512, "height": 341,
  "updated_at": "2026-10-09T10:12:00Z", "expires_in_seconds": 900 }
```
When there's no image, **every field is `null`**: the status is still 200,
and the app shows initials. **`url` expires** (15 minutes). Fetch it again
rather than caching it, and fall back to initials if it fails to load.

---

## 1. Your own photo — `/profile/photo`

**Auth:** any signed-in account (candidate, employer member, college member, staff).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/profile/photo` | — | `ImageResponse` (nulls if none) |
| POST | `/profile/photo/upload` | — | `201 UploadTicketResponse` |
| POST | `/profile/photo/confirm` | `{ "upload_id": "…" }` | `ImageResponse` |
| DELETE | `/profile/photo` | — | `ImageResponse` with nulls |

## 2. Employer logo — `/employer/organisation/logo`

| Method | Path | Who | Response |
|---|---|---|---|
| GET | `/employer/organisation/logo` | owner, recruiter, viewer | `ImageResponse` |
| POST | `/employer/organisation/logo/upload` | **owner** | `201 UploadTicketResponse` |
| POST | `/employer/organisation/logo/confirm` | **owner** | `ImageResponse` |
| DELETE | `/employer/organisation/logo` | **owner** | `ImageResponse` with nulls |

## 3. College logo — `/college/organisation/logo`

The same four routes. Read: college admin and staff. Change: **college admin** only.

## 4. Where else images appear

Since 2026-10-10, **every response that names an employer or a college
carries its logo**, and the screens that are yours carry your own photo.
Each is a presigned `url` string (or `null`) that expires like the one in
`ImageResponse`: show it, don't store it.

### Logos — beside the organisation's name

| Who reads it | Where | Field |
|---|---|---|
| Candidate | Job board, job detail, both recommended-jobs lists | `employer_logo_url` |
| Candidate | `GET /candidate/applications`, `…/{id}`, apply, withdraw, confirm/dispute hire | `employer_logo_url` |
| Candidate | `GET /candidate/applications/{id}/messages` | `employer_logo_url` |
| Candidate | `GET /candidate/shortlist-invitations` (and accept/decline) | `employer_logo_url` |
| Candidate | `GET /candidate/profile/views` | `employer_logo_url` |
| Candidate | `GET /candidate/colleges`, link by code, accept invitation | `college_logo_url` |
| Candidate | `GET /candidate/colleges/invitations` | `college_logo_url` |
| College | `GET /college/students/{id}` → `hires[]` | `employer_logo_url` |
| College | `GET /college/students/{id}/details` → `applications[]` | `employer_logo_url` |
| The organisation | `GET/POST/PATCH /employer/organisation`, `GET/POST/PATCH /college/organisation` | `logo_url` |
| Any member | `GET /auth/me` | `organisation_logo_url` (null for a candidate) |
| Staff | `/admin/tenants`, `/admin/employers/{id}`, `/admin/colleges/{id}` | `logo_url` |
| Staff | `/admin/kyb/submissions`, discount-code redemptions, dashboard `oldest_waiting` | `organisation_logo_url` |
| Staff | candidate drill-down and onboarding → `college_links[]` | `college_logo_url` |
| Staff | `/admin/candidates/{id}/applications` | `employer_logo_url` |

### Photos — your own screens, and staff

| Who reads it | Where | Field |
|---|---|---|
| Anyone, their own | `GET /auth/me` | `photo_url` |
| Candidate, their own | `GET /candidate/profile`, `PUT …/location`, `PUT …/name` | `photo_url` |
| Staff | `/admin/candidates` (list), `/admin/candidates/{id}`, `…/onboarding` | `photo_url` |
| Staff | `/admin/integrity/signals` and `…/{id}` → `candidate` | `photo_url` |

**Not on any employer- or college-facing response**: masked search cards,
the reveal, applicant cards and the opened application, the shortlist, and
the college's roster and student pages carry **no** photo field. That is the
2026-10-09 rule above, and it stays.

**Team lists** (`/employer/team`, `/college/team`) carry no photo either:
the reach test refuses a photo field in those modules' schemas, whosever it
is. A member's own photo is on their `/auth/me`.

- **Data export** includes a `photo` section (type, size, date set). To get
  the image itself, call `GET /profile/photo`.
- **Erasure** deletes the photo from storage first, then the row.
