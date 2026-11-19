# Job taxonomy API

Base path: `/api/v1`. Interactive schemas are also available in the backend's `/docs`.

## Read catalogue

These GET routes are public. They return visible, non-archived options, ordered by
priority, then `sort_order`, name and ID. Hidden/archived ancestors hide descendants.

| Route | Required query |
|---|---|
| `/taxonomy/industries` | none |
| `/taxonomy/departments` | `industry_id` |
| `/taxonomy/categories` | `department_id` |
| `/taxonomy/roles` | `category_id` |

All accept `q` (case-insensitive substring, up to 160 characters), `offset >= 0`
and `limit` (1–1000). Industries/departments default to 1000; categories/roles to
100. Response: `{items: [{id, name, slug, parent_id, type, sort_order, is_visible,
is_user_added, version, updated_at}], total, offset, has_more}`. An empty selection
returns an empty `items` list; a missing or hidden parent returns 404.

Departments are independent master data. Every industry can choose every visible
department. Its priority rows come first, then the remaining departments.

Redis caches reads for 30 seconds, keyed by a PostgreSQL catalogue revision.
Mutations advance that revision in their transaction, including imports and moderation.
Redis failure falls back to PostgreSQL; it does not prevent reads or saves.

## Candidate profile

The existing `PUT /candidate/profile/details` accepts the additional fields below.
Existing `industry`, `department`, `role_category`, and `job_role` remain label
snapshots used by profile displays, resumes, recommendations and older clients.

```json
{
  "details": {
    "industry_id": "<industry UUID>",
    "department_id": "<department UUID>",
    "role_category_id": null,
    "job_role_id": null,
    "role_category": "A new specialty",
    "job_role": "A specialist role",
    "taxonomy_others": {
      "role_category": "A new specialty",
      "job_role": "A specialist role"
    }
  },
  "complete": false
}
```

IDs supply authoritative labels on first selection. Later saves retain the user's
snapshot even if an administrator renames, hides, archives or moves that option.
New selections must use the active hierarchy. Existing selections can retain their
original parent chain after a move. New choices under Others must be text.

Each explicitly selected Others answer needs non-empty text. Names are Unicode
normalized, trimmed, whitespace-collapsed, limited to 160 characters and checked
for markup/control characters. Matching an existing visible option yields 409
`taxonomy_use_existing`, with `params.fields` and `params.option_id`.

Older clients can continue submitting names only. Known names map to IDs within
their parent; unmatched names become suggestions. Repeated identical saves reuse
the submission. A database-serialized limit allows 40 distinct suggestions per
user in a rolling 24 hours; additional submissions return 429
`taxonomy_submission_limit` without losing the last saved profile.

## Administration

Every route under `/admin/taxonomy` requires an active `PLATFORM_ADMIN` membership.
Candidates, support staff, employers and institutions cannot maintain the catalogue.
Changes, exports and suggestion reads are audit-logged as `taxonomy_changed`.
Suggestions have RLS; candidates cannot read another user's suggestions.

`{level}` is `industry`, `department`, `category` or `role`.

| Method and path | Request / behavior |
|---|---|
| `GET /admin/taxonomy/{level}` | `q`, `parent_id`, `offset`, `limit`; includes usage, parent, pending count |
| `POST /admin/taxonomy/{level}` | `{name, parent_id?, type?, is_visible?, sort_order?}` |
| `PUT /admin/taxonomy/{level}/{id}` | Same fields plus the current `version`; can rename, move, hide/show |
| `DELETE /admin/taxonomy/{level}/{id}?version=N` | Soft archive; snapshots and ID remain intact |
| `DELETE ...?version=N&hard=true` | Permanent delete only if no current profiles, children or moderation history reference it |
| `POST /admin/taxonomy/{level}/reorder` | `{ids: [...], versions: {"UUID": N}}`; complete list within one parent |
| `GET /admin/taxonomy/priorities/{industry_id}` | `{department_ids, revision}` |
| `PUT /admin/taxonomy/priorities/{industry_id}` | `{department_ids: [...], revision}` |
| `GET /admin/taxonomy/{level}/export?format=csv` | Download CSV; `format=xlsx` also supported |
| `POST /admin/taxonomy/{level}/import` | Multipart `file`; CSV or XLSX, maximum 2 MB and 2,000 rows |
| `GET /admin/taxonomy/others` | `status`, `level`, `q`, `offset`, `limit` |
| `POST /admin/taxonomy/others/{id}/resolve` | `{action, version, name?, parent_id?, type?, option_id?}` |

`type` is `Tech` or `Non-tech` for departments. Categories need a department parent;
roles need a category parent. Industries and departments have no parent.
Duplicate trimmed/case-insensitive names are rejected within the same parent.
All mutation failures roll back the import/action and its audit rows.

Moderation actions: `approve` creates a visible user-added option, `merge` requires
an existing visible `option_id`, and `reject` retains the user's custom text.
Matching pending suggestions in the same context are resolved together. The actor
is checked again inside the database function that re-links profiles across users.
It updates only users whose answer is still the submitted text. Child suggestions
follow an approved parent so they can be reviewed next.

Optimistic versions/revisions reject stale edits with 409 `taxonomy_changed`.
Administrator writes take a consistent catalogue lock to keep bulk actions and
individual edits from acquiring locks in conflicting orders.

## Seed and migration

Run from `backend` with the intended local environment loaded:

```powershell
..\.venv\Scripts\python.exe -m alembic upgrade head
..\.venv\Scripts\python.exe -m scripts.seed_job_taxonomy
```

Migration `0023_job_taxonomy` follows the existing salary-currency migration. The
seed loads `backend/data/job_taxonomy.json`, extracted from the supplied **India
Job Taxonomy Explorer.html**, rather than executable JavaScript or hardcoded
application enums. Source filename and SHA-256 are retained in the data file.
Its input must contain exactly **31 industries, 29 departments, 110 role categories,
507 roles** before anything is written. Re-running is additive and preserves admin
edits, visibility, archives and priority changes.

`--source path.html` accepts the supplied explorer directly. `--source path.xlsx`
accepts sheets named `Department Master` (Department, Type, Role Category, Job Role)
and `Industry Dept Priority` (Industry, Department, Rank). Blank department/category
cells in the master inherit the preceding value. CSV/XLSX *admin* imports instead
use the exported flat template. The workbook mentioned in the request was not
attached; the supplied HTML is the verified seed source.

The seed also backfills historical profile names: matching values get IDs;
unmatched values retain their label and create Others submissions. No profile is
scored or charged by this operation. It uses the migrator role for this bounded
cross-user operation. Remote databases are refused unless `--allow-remote` is
explicitly supplied. No AWS database is changed just by editing these files.

## Verification

Backend: `pytest tests/unit/test_job_taxonomy.py tests/integration/test_job_taxonomy.py`.
Use a separately initialized test database with the project's roles/extensions and
`AUTH_ALLOW_LOCAL_TOKENS=true`. Do not point integration tests at production.

Client cascade parity: from `frontend`, run `node --test tests/taxonomy-state.test.mjs`.
Run TypeScript checks in both client directories. No new runtime dependencies were added.
