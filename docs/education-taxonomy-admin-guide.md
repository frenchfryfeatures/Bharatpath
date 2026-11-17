# Education taxonomy admin guide

Open **Admin → Education Taxonomy** using a Platform Admin account. Tabs are Qualifications, Courses, Specializations and Others Submissions. Existing table, dropdown, modal, icon and button components are reused.

- Search names and filter Courses by Qualification or Specializations by Course.
- Add/Edit changes the name, visibility and order. Qualifications also have a level rank, 9 highest to 1 lowest. To move a course, change its qualification.
- The eye hides or shows an option. Delete archives it; hard deletion is blocked for options with saved usage, descendants, attachments or moderation history. Prefer hiding when temporarily unavailable. Existing user snapshots remain readable.
- Drag rows or use arrows to reorder. Clear search first; select a parent for course or per-course specialization ordering. Changes use version checks; refresh after a stale-edit message.
- Specializations are shared. Renaming or hiding one affects every attached course. The course column lists attachments. Use **Manage links** to select multiple courses and specialties, then attach or detach them. Detaching affects future choices and preserves saved users.
- Export CSV or XLSX before bulk editing, keep column order and versions, and import it back. Keep IDs for updates, leave IDs blank for additions. Course links use pipe-separated UUIDs. Imports add links; use Manage links to remove them. A bad row rolls back the entire file.
- In Others Submissions, filter by status/level and search. Review the parent chain, user, date and matching-user count. **Add as dropdown option** lets you edit the name and parent; merge links to an existing option; reject leaves the user's custom answer intact. Matching pending entries in that context are resolved together, and users whose answers are still current are automatically linked.

“General / Not applicable” is a special flagged option. It is hidden from the form and auto-selected only when it is the course's sole visible option. Do not rename it to a real specialty. Attach real specialties to the course when a selection should be shown.

## Local setup and seed

The supplied HTML explorer was converted to `backend/data/education_taxonomy.csv` without executing the document. Provenance and source checksum are stored beside it. Reproduce the conversion with:

```powershell
.venv/Scripts/python.exe backend/scripts/extract_education_taxonomy.py --source "C:/Users/risha/Downloads/India Education Taxonomy Explorer.html"
```

From `backend`, using the existing local environment:

```powershell
$env:PYTHONPATH=(Get-Location).Path
../.venv/Scripts/python.exe -m alembic upgrade head
../.venv/Scripts/python.exe scripts/seed_education_taxonomy.py
```

The seed is additive and idempotent, loads CSV rows rather than hardcoding choices, preserves admin edits/archives/detached seeded links, and backfills matching historical labels to IDs. Unmatched labels remain snapshots and enter Others. The database owner/migrator connection is required for cross-user backfill. Remote targets are refused by default; production requires an intentional deployment and `--allow-remote`. Nothing here deploys to AWS automatically.

Verified source counts: **9 qualifications, 123 courses, 414 unique specializations (413 ordinary + 1 flagged N/A), 1099 course-specialization links**. Qualification order is Doctorate/PhD, Post Graduation, Graduation, Diploma/Polytechnic, ITI/Vocational, Professional Qualification, 12th Pass, 10th Pass, Below 10th.

## Checks

Backend unit/integration tests: `tests/unit/test_education_taxonomy.py`, `tests/integration/test_education_taxonomy.py`. Client cascade/N/A checks: `node --test frontend/tests/education-state.test.mjs`. Web and mobile both have TypeScript checks. API details and import schema: [Education taxonomy API](education-taxonomy-api.md).
