# Resume fields across web and mobile

Resume creation, review, missing-section entry and profile resume editing use the complete `StructuredResume` schema in `backend/app/modules/resume/structuring.py`.

The shared fields cover name, headline, location, summary, all contact links (including custom links), experience, education, skills, projects, certifications, languages, achievements, interests and additional sections. Nested metadata includes employment type, skills used, education description, project dates, credential IDs and credential URLs. Career-profile-only fields remain in the career profile.

Web creation and manual entry share `ResumeContentFields`. Web review creates its field tree from the complete document and generated record defaults. Mobile creation and review share `BuilderField`, `BuilderRepeater` and the field descriptors in `resume-builder/model.ts`; the manual-entry compatibility wrapper also opens this full editor.

## API

- `POST /api/v1/candidate/resume/document`: candidate-only, accepts the complete `StructuredResume`; creates an unconfirmed MANUAL version.
- `POST /api/v1/candidate/resume/versions/{id}/edit`: send `{ "structured_resume": <complete document> }` to create an unconfirmed immutable EDIT version. Exactly one of this field, `text`, legacy `structured`, or `sections` is accepted.
- Existing text, upload and legacy manual APIs remain supported for older clients.
- Full document writes preserve the structured view without AI re-extraction. Scoring uses the existing privacy-safe builder projection. Saved versions remain immutable and stale edits return 409.
- BUILDER versions reopen the builder with the selected version's full content, then regenerate their PDF through the existing builder APIs.

No database migration is needed: the existing version JSON document stores the full schema. Existing versions remain unchanged until a user saves an edit. Old manual records map their year and employer/title fields into the full editor; unstructured legacy text is retained in additional information.

## Updating the contract

After changing the backend schema, run from `backend` with the project environment activated:

```powershell
$env:PYTHONPATH=(Get-Location).Path
python scripts/export_resume_editor_contract.py
```

Commit both generated client JSON files. The document tests verify they exactly match the backend schema and that mobile controls cover every nested field.

## Review preview and download

The eye and download actions in web and mobile review call the candidate-only `GET /api/v1/candidate/resume/versions/{id}/render` endpoint. The default returns a PDF attachment; `?format=png` returns preview pages and a truncation flag. Both render the selected immutable version, retain its saved builder template when available, and leave drafts, confirmation and scoring untouched. The web actions require unsaved section edits to be saved first. Mobile downloads use the system save/share sheet.
