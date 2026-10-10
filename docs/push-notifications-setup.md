# Phone notifications: Android and iOS

The installed app asks for OS notification permission during onboarding, registers its Expo push token with `POST /api/v1/notifications/devices`, and refreshes the token when the app returns to the foreground. The backend sends a generic lock-screen message for new unread inbox events through Expo Push Service. Tapping it opens the inbox. Android uses the `default` channel at high importance with the device's default sound; iOS requests alerts and sound. The notification inbox never asks for permission again, whether the user allowed or declined it. The user can later change OS permission in phone settings.

Pushes are for BharatPath events. An app cannot receive or control notifications sent by unrelated apps. Android/iOS settings, Focus/Do Not Disturb, and sound volume still control whether a notification makes a sound.

## Required credentials before live delivery

1. Create a Firebase project with an Android app whose package is `com.bharatpath.app`. Obtain its `google-services.json`. Put it at `mobile-app/google-services.json` (gitignored) or set `GOOGLE_SERVICES_JSON` to the file path for the EAS build. Do not commit this file.
2. Upload an FCM V1 service account key to the **existing EAS project** (`df62c601-df79-4743-9167-7666f4a705f5`) using EAS credentials. Keep the private key in EAS; do not put it in this repository.
3. For iOS, configure the Apple Push Notification service key in EAS credentials for bundle ID `com.bharatpath.app`. Use an Apple Developer account and a real iPhone for delivery testing. iOS simulators cannot verify the complete APNs delivery path.
4. Run backend migration `0014_push_devices`, deploy the backend and Celery worker/beat schedule, then build **new native binaries** for Android and iOS. OTA JavaScript updates cannot add missing native FCM/APNs configuration.
5. On each installed build, sign in to a test account, tap **Allow notifications** during onboarding, verify OS permission, then trigger a safe test inbox event. Confirm the tray alert and sound while the app is foregrounded, backgrounded, and closed. Reopen the notification inbox after both **Allow notifications** and **Not now**: neither choice should show a permission card there. Test logout and login with another test account to verify token reassignment.

The backend retries transient Expo errors up to three times, checks push receipts, and deactivates tokens rejected as `DeviceNotRegistered`. It sends generic text to avoid exposing inbox details on a lock screen. The device token table participates in account erasure.

## Current verification

- TypeScript, Android and iOS JavaScript exports, mobile notification mocks, backend unit/integration tests, and migration on an isolated PostgreSQL database pass.
- No native device build, FCM/APNs credential check, or real push delivery was possible in the current environment. Do not treat phone delivery or sound as verified until step 5 passes on physical devices.
