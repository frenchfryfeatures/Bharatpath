# Android mobile release audit — 10 October 2026

## Decision

**Not release ready.** Static checks, existing mobile tests, new resilience tests, and an Android JavaScript bundle export pass. No Android device or SDK is available in this environment, so there is no native AAB, installed release build, Logcat trace, or observed end-to-end journey. Live Cognito, backend, payment, upload, and notification behavior was not exercised against production data.

## Scope and architecture

The mobile app is Expo SDK 54, React Native 0.81.5, React 19.1, and Expo Router 6. It calls a FastAPI backend through `services/api/client.ts`. Cognito handles authentication; `AuthContext` restores session, name, and score from AsyncStorage. Resume intake uses a multipart upload to `/candidate/resume/intake`, then fetches a version, maps structured fields to the career profile, and routes through review, edit, confirm, and scoring. Payments, jobs, applications, interviews, college, courses, notifications, streaks, and privacy flows use separate API service modules. The EAS production profile specifies an HTTPS API and disables the development token flag.

### Route and screen inventory

| Area | Routes and screens | Main interactions | Audit status |
| --- | --- | --- | --- |
| Launch and account | `/` (splash, intro, signup, login, email verification, password reset, language, how it works, referral, notification permission) | Resume session, create or sign in, verify email, reset password, resume onboarding | Code mapped and bundled; device/API journey **untested** |
| Resume and score | `/` onboarding states, `/resume-details`, `/profile-details`, `/share-result` | Pick PDF/DOCX, paste, manual form, parse, edit/add/delete sections, confirm, score, share | Service and transformation tests **pass**; device/API journey **untested** |
| Main tabs | `/home`, `/jobs`, `/board`, `/you` | Dashboard, search/filter jobs, applications, profile navigation | Code mapped and bundled; device/API journey **untested** |
| Jobs | `/job-short`, `/job-detail`, `/application-sent`, `/application-detail` | View job, apply, board/detail, messages | Code mapped and bundled; live submission **untested** |
| Attribute check | `/attribute-check`, `/attribute-quiz`, `/attribute-report` | Start, answer, submit, view report | Code mapped and bundled; API journey **untested** |
| Interview | `/mock-interview`, `/device-check`, `/interview-session`, `/interview-sessions`, `/interview-report` | Permissions, device check, record/upload answers, report | Code mapped and bundled; camera/microphone/device journey **untested** |
| Profile and extras | `/who-has-seen-me`, `/notifications`, `/streak`, `/courses`, `/course-detail`, `/college`, `/subscription` | Privacy, inbox, streak, lessons, consent, subscription | Code mapped and bundled; API/device journey **untested** |
| Fallback | `/+not-found` | Unknown route | Code mapped and bundled; deep link behavior **untested** |

The app has about 463 route/screen interaction references and 110 API request references. This is a code inventory, not a claim that each control was tapped.

## Test scenarios and results

| Scenario | Result | Evidence or limit |
| --- | --- | --- |
| TypeScript | **Pass** | `npm run typecheck` |
| Lint | **Pass with 28 warnings** | `npm run lint`; no errors, mostly unused imports and one effect dependency warning |
| Existing mobile tests | **Pass** | All `mobile-app/tests/*.cjs`: auth refresh, college, messages, onboarding, resume update, streak, structured resume, subscription |
| New resume edge cases | **Pass** | Empty/oversize/unsupported/missing file; malformed resume details and structured sections; malformed JSON and offline API error |
| Android JS bundle | **Pass** | `npx expo export --platform android`; 4,444 modules bundled, 11 MB Hermes bundle |
| Expo dependency compatibility | **Limited pass** | `npx expo install --check` reports up to date using its local map; offline validation is less reliable |
| Backend resume unit suite | **Blocked** | Existing pytest fixtures require Redis at localhost:6379; sandbox disallows the socket connection. No backend result claimed. |
| Native Android build, install, Logcat, layout, back navigation, picker, permissions, background/foreground | **Untested** | No `adb`, Android SDK, emulator, or connected device |
| Browser runtime smoke | **Blocked** | Expo web server did not become reachable on localhost:19006, and no computer-use browser surface was available. No first-screen rendering pass is claimed. |
| Live account/API, payment, file upload, score, interview, notifications | **Untested** | No safe test account or isolated backend supplied; no production-changing requests were sent |
| Expo Doctor | **Blocked** | Package was not locally installed and npm registry DNS was unavailable |

## Bugs and fixes

| Severity | Reproduction / root cause | Fix and verification |
| --- | --- | --- |
| **P1** duplicate resume creation on retry | Submit a resume, let version creation succeed, then fail detail/profile fetch. Retry previously called intake again, potentially superseding the prior version. | `ParsingScreen` now remembers the created version and retries downstream work; concurrent retry taps are ignored. Typecheck and bundle pass. This exact device journey remains unverified. |
| **P1** crash risk from malformed resume JSON | Return `READY` with malformed structured arrays or null list entries, or invalid `parsed`/`sections` fields. Render/map code could call `.map`, `.trim`, or `Object.entries` on wrong types. | Detail response normalization and structured shape checks now reject malformed fields and retain a safe fallback. Regression tests pass. |
| **P2** unsupported and empty files accepted by picker UI | Select `.txt`, legacy `.doc`, empty, or over 5 MB file. Picker UI previously offered types the backend rejects and did not check size. | Both intake pickers now accept PDF/DOCX and show an actionable error for invalid files. Pure validation tests pass. Picker UI remains unverified on device. |
| **P2** network request could wait indefinitely or expose a raw JSON parsing error | Stall an API request or return broken JSON with `application/json`. | API client now uses 30 s timeout (120 s multipart) and a meaningful malformed response error. Mocked offline/malformed JSON tests pass. Native abort behavior remains unverified. |
| **P2** API error logs could expose response data | Return an error body containing personal details. The shared client previously logged the entire JSON body and native network error object. | Logging now records the method, route, and status without response bodies. Typecheck and tests pass. |
| **P1** production artifact configured as APK | Production EAS profile used `buildType: apk`, unsuitable as the Play upload artifact. | Changed production to `app-bundle`; config validation passes. Actual AAB generation is unverified. |
| **P2** Android version code not explicit | `app.json` omitted `android.versionCode`, creating ambiguity for the first Play upload and future increments. | Set version code to 1; `expo config` confirms package `com.bharatpath.app`, version `1.0.0`, code `1`. Increment for each future Play release. |

## Open release risks

1. **P1 security:** `authStorage.ts` stores access and refresh tokens in AsyncStorage. Assess migration to Android encrypted storage and session migration before release. This audit did not change token storage because the secure storage dependency and migration path need native verification.
2. **P1 stability:** No installed release-like Android build has been launched. Resume upload, parsing, edit/confirm, score, back navigation, app resume, and low connectivity need physical or emulator testing with Logcat.
3. **P1 integration:** Production API/Cognito configuration is present in EAS, but availability, certificate behavior, authentication, session expiry, permissions, and payment callbacks were not verified.
4. **P2 behavior:** The review editor creates a new version before fetching its details; a failed details fetch can leave an unconfirmed version requiring recovery. Retest rapid edits, network loss after save, and reopening the route.
5. **P2 accessibility/UI:** No screen-size, font-scale, keyboard, safe-area, dark mode, or TalkBack pass was possible. Android camera, audio, and notification permission prompts also need device review.

## Release gate to complete

Produce a signed **AAB** with the production EAS profile; install an equivalent release build on at least a small and a large Android device; capture Logcat while completing the account, resume PDF/DOCX upload, paste/manual intake, edit/add/delete/confirm, scoring recovery, jobs, interview, courses, subscription sandbox, and logout/session restore journeys. Exercise offline, timeout, picker cancellation, rapid taps, background return, and denied permissions. Run backend integration tests with isolated Redis/Postgres and safe fixtures. Upload to Play internal testing only after these checks pass, then review the Play pre-launch report and crashes before production rollout.

## Notification implementation addendum

The notification choice is made during onboarding. The inbox now shows only messages and never repeats **Allow notifications** or **Not now**, regardless of the user's decision. Onboarding requests Android/iOS OS permission when **Allow notifications** is tapped and offers phone settings after permanent denial. The app registers and refreshes its Expo push token, removes it at sign-out or revocation where online, and opens the inbox after a push tap.

The backend now stores per-user devices, queues one push per eligible unread in-app event, sends generic lock-screen text with default sound, checks Expo receipts, and deactivates invalid tokens. Migration `0014_push_devices` and account erasure were exercised against an isolated PostgreSQL database. Mocked Expo API tests and the notification/privacy suite passed **34 tests**. TypeScript, lint (0 errors, 28 existing warnings), and both Android and iOS JavaScript exports passed. The Android/iOS permission-registration mock passed. See [push-notifications-setup.md](push-notifications-setup.md) for setup and device verification.

**P1 release blocker:** The resolved Expo config reports `googleServicesConfigured: false`; Android FCM cannot be verified without a Firebase `google-services.json` and EAS FCM V1 credentials. iOS APNs credentials and a physical device are also unverified. No native build or real phone delivery/sound was tested. These results establish code and isolated backend behavior, not live push readiness.
