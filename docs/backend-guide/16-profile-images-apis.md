# 16 — Profile photos & organisation logos: input/output reference

Added 2026-10-09. Two kinds of image, one module (`profile_images`):

| Image | Whose | Who sets it | Who sees it |
|---|---|---|---|
| **Profile photo** | Every signed-in person: student, employer member, college member, BharatPath staff | The person, for themselves | The person, and BharatPath staff (student photos appear on the admin console's full candidate page). **A student's photo is never shown to an employer or a college.** |
| **Organisation logo** | An employer or a college | Employer: the **owner**. College: the **college admin**. | Every member of that organisation, and every candidate who sees the employer's jobs (`employer_logo_url` on the board) |

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

- **Job board** (`GET /candidate/jobs`, `GET /candidate/jobs/{id}`, and both
  recommended-jobs lists): every job carries **`employer_logo_url`** (null
  without a logo). See [05](05-jobs-and-discovery-apis.md).
- **Admin console** `GET /admin/candidates/{id}/onboarding` carries
  **`photo_url`**, the student's photo. It's audited like the rest of that
  page. See [13](13-admin-console-and-disputes-apis.md).
- **Data export** includes a `photo` section (type, size, date set). To get
  the image itself, call `GET /profile/photo`.
- **Erasure** deletes the photo from storage first, then the row.
