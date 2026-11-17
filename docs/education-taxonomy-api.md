# Education taxonomy API

Base: `/api/v1`. Full request schemas are also published in backend `/docs`.

## Public catalogue

| GET route | Parent query |
| --- | --- |
| `/education-taxonomy/qualifications` | none |
| `/education-taxonomy/courses` | `qualification_id` |
| `/education-taxonomy/specializations` | `course_id` |

All accept `q` (case-insensitive substring, max 160 characters), `offset` and `limit` (1–1000). Responses contain `items`, `total`, `offset`, `has_more`. Items include `id`, `name`, `slug`, `sort_order`, `version`, `level_rank` (qualifications) and `is_not_applicable` (specializations). Hidden/archived choices, links and ancestors are excluded. Qualifications are ordered highest first; courses use their own order and specializations use their course-link order.

Reads use Redis for 30 seconds keyed by a transactionally incremented catalogue revision. Redis outages fall back to PostgreSQL. Job and education catalogues share the revision lock, audit action and existing authentication conventions. Specializations are globally shared masters; `course_specializations` owns attachments and per-course ordering. `education_courses` is deliberately separate from the existing paid-learning `courses` table.

Qualification `level_rank` runs from 9 (Doctorate / PhD) down to 1 (Below 10th). Recruiter queries can join `highest_qualification_id` to qualifications and compare `level_rank >= 7` for Graduation and above; do not compare display strings.

## Profile writes and compatibility

`PUT /candidate/profile/details` extends the existing details object:

```json
{
  "details": {
    "highest_qualification_id": "<qualification UUID>",
    "course_id": "<course UUID>",
    "specialization_id": null,
    "specialization": "A new specialty",
    "education_others": {"specialization": "A new specialty"}
  },
  "complete": false
}
```

Labels `highest_qualification`, `course`, `specialization` remain snapshots. IDs must follow the selected hierarchy. Existing saved hidden, moved, archived or detached choices retain their original IDs and snapshots. New selections must be visible and attached. A sole visible specialization with `is_not_applicable=true` is auto-selected, and clients hide that field. This rule uses the flag rather than a label comparison.

Others keys are `highest_qualification`, `course`, `specialization`. Text must be non-empty, normalized, trimmed, plain text and at most 160 characters. Others at an ancestor makes descendants custom text. Each custom answer creates a moderation submission. A matching visible option returns 409 `taxonomy_use_existing` with field and option ID; choose it instead. Names-only writes from old app versions are still accepted: matching values acquire IDs and unmatched text becomes Others. The seed script performs the same backfill for existing profiles.

Repeated identical suggestions are deduplicated. Each user may submit 40 distinct education suggestions in a rolling day; further writes return 429 `taxonomy_submission_limit` without changing the saved profile.

## Administration

Requires existing `PLATFORM_ADMIN` authorization. Other staff roles are denied. Audit records use `taxonomy_changed`, target type `education_taxonomy`.

`/admin/education-taxonomy` supports:

| Method/path | Purpose |
| --- | --- |
| `GET /{level}` | Search/filter options, include hidden; usage, pending counts, parent and courses |
| `POST /{level}` | Create option |
| `PUT /{level}/{id}` | Rename, visibility, order, rank; move course using `parent_id` |
| `DELETE /{level}/{id}?version=N` | Archive |
| `DELETE /{level}/{id}?version=N&hard=true` | Delete only if unused and without references/history |
| `POST /{level}/reorder` | `{ids, versions, parent_id}`; specialization course order uses `link_version` |
| `GET /revision` | Current revision for link edits |
| `GET /links/{specialization_id}` | Attached course IDs and revision |
| `PUT /links` | `{course_ids, specialization_ids, action: attach/detach, revision}` |
| `GET /{level}/export?format=csv/xlsx` | Export reusable import template |
| `POST /{level}/import` | Multipart `file`; transactional import |
| `GET /others` | Status/level/search/paging, user, chain and same-text count |
| `POST /others/{id}/resolve` | Approve, merge or reject |

`level` is singular `qualification`, `course`, `specialization`. Writes include `version` from the latest row; stale edits return 409 `taxonomy_changed`. Link writes require the latest global revision and apply at most 2000 course/specialization pairs. Duplicate trimmed case-insensitive names are rejected globally for qualifications/specializations and within each qualification for courses. N/A is a protected flagged master, not a normal specialty.

Resolve body: `{action, version, name?, parent_id?, option_id?, level_rank?}`. Approve creates an option; merge chooses an existing option and attaches a shared specialization when necessary. Matching pending entries in the same context resolve together. Still-current saved answers are re-linked through a narrowly scoped, actor-checked database function; rejected text stays on the user profile. Access is protected by RBAC plus submission-table row security.

Export/import columns: `id,name,parent_id,level_rank,sort_order,is_visible,version,course_ids,is_not_applicable`. `course_ids` is pipe-separated. Blank IDs create rows; populated IDs update with optimistic concurrency. Attachments are additive on import: detach through the link action. Imports accept CSV/XLSX, max 2 MB / 2000 data rows, and roll back completely on a bad row.
