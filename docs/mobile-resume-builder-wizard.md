# Mobile resume builder

The React Native builder starts with Classic, Modern, Sidebar and Minimal template selection, then opens six steps: Personal Information, Experience, Education, Skills, Projects, More. Templates can be changed from any step without resetting content. Each miniature is an actual PNG produced by the existing server renderer with fictional sample content; previews are cached by catalogue version and template.

The wizard retains the shared StructuredResume payload and existing endpoints. No database migration or web portal change is required. The mobile DTO now explicitly includes the project dates and certification metadata already supported by the backend and web editor. All existing contact links, experience details, education, skills, projects, certifications, languages, achievements, interests and additional sections remain available.

## Saving and output

- A single shared draft holds every step. Step navigation validates its current entries and keeps the draft intact.
- Autosave waits 700 ms after changes, serializes requests and coalesces intermediate edits. An older request cannot finish after a newer request from this editor.
- The cloud is idle, the spinner indicates a real write, and the green check appears only after successful persistence. It returns to idle after 1.6 seconds. Failed saves show an error and retry action.
- Pending edits are backed up in device storage, scoped to the API and candidate. A later session offers to restore a differing backup rather than silently replacing the server draft.
- Preview, download, final submission and leaving the builder flush pending changes. Failed saves keep the editor open; leaving with the device backup requires the user's explicit action.
- Preview and PDF download use the existing APIs. Final submission uses the existing push endpoint and hands the resulting resume version to the existing navigation callback.
- Upload CV is a secondary Personal Information action and uses the existing upload flow. A newer CV offers the existing refresh/keep-draft actions.

The footer contains Next Step on steps 1–5. Only More (step 6) shows Use this resume and continue. Entry editors support multiple records, validation, edit and removal. Current employment hides its ending date. Saved year-only dates remain supported by the existing API. Safe-area and keyboard-avoiding containers keep the footer outside the scrolling form; focused inputs are scrolled into view.

## Verification

- `node --test mobile-app/tests/resume-builder-wizard.cjs`: debounce, coalescing, serialization, failed-save retries, flushing before exit, initial draft persistence, step/final validation and supported field coverage.
- `npx tsc --noEmit` from mobile-app.
- Android and iOS Expo export checks.
- Backend renderer suite: 43 tests, including all four templates, PNG previews and PDF rendering.
- Backend integration suite: 19 tests pass unchanged. Two old profile-completion fixtures omit mandatory notice period and specialization. An isolated compatibility run supplying those existing required fields passes all 21 tests; repository backend fixtures are unchanged.
- In-memory mobile-width UI preview: template choice, required name validation, add/edit experience, add/remove education, skill persistence, projects, certification validation, template changes after editing, full-screen preview and final handoff. Layouts checked at 320, 360 and 393 pixels.
- Web builder source hashes verified unchanged.

Browser previews verify layout and editor interactions, not physical device keyboards or OS share sheets. Android/iOS hardware or simulator acceptance remains necessary for those platform-specific behaviors. No preview fixtures or test routes ship in the application.
