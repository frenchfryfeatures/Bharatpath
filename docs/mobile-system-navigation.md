# Mobile system navigation and notifications

Implemented on 19 November 2026. This is a source/configuration audit and
responsive preview verification, not a physical-device certification.

## Coverage and design

- All routes, including authentication and onboarding inside the entry route,
  inherit `SystemNavigationFrame` in `app/_layout.tsx`.
- The source audit inspected 59 TSX files under `screens` and all native Modal
  uses under `app`, `screens` and `components`. All 25 modal windows across 22
  components use `AppModal`. This includes filters, dropdowns, phone selection,
  assistant, resume editing/preview, account dialogs, checkout and lesson player.
- The frame reserves the measured bottom system inset as an opaque surface,
  clips application content above it, and supplies a consumed bottom inset of
  zero to descendants. Existing bottom SafeAreaViews and floating navigation do
  not reserve the same space twice. Top/left/right insets are preserved.
- Native modals establish a new SafeAreaProvider from the original window
  metrics. They measure their own window and reserve its bottom inset separately.
  Transparent backdrops stay transparent above the protected system area.
- Current app bottom surfaces are light, including the white lower sheet on the
  purple score screen, so the system strip is white with dark Android buttons.
  The frame also supports a black surface with light buttons for dark root views.
  Select the surface from the actual screen background, not merely OS dark mode.
- Android system navigation is explicitly visible and restored on foregrounding
  or a native visibility change. The native stack keeps the iOS home indicator
  enabled. The floating tab bar is opaque and hides while the keyboard is open.
- Jobs and Board use a shared top-right notification button. It opens the existing
  inbox and refreshes the unread dot whenever the screen regains focus.

## Native configuration and release

`expo-navigation-bar` 5.0.10 is installed for Expo SDK 54. The config plugin sets
the default background, button contrast and visibility. A small local plugin
disables the redundant Android navigation contrast scrim because the application
already paints a solid safe-area background. Config introspection verified
`android:windowLightNavigationBar=true` and
`android:enforceNavigationBarContrast=false` in AppTheme.

Build a new Android/iOS native binary through the existing EAS profiles before
validating this release. An OTA update alone cannot add a missing native module
or change the compiled Android theme. An existing custom development client also
needs rebuilding; Expo Go includes this Expo module.

## Verification

- TypeScript checks.
- `node tests/system-navigation.cjs`: inset consumption, clipping, light/dark
  colors and contrast, visibility restoration, independent modal metrics,
  transparent backdrop preservation, all-modal coverage, notification routing
  and unread state, and keyboard/tab-bar behavior.
- Existing application preview/confirmation and assistant navigation checks.
- Seven additional onboarding/resume test scripts passed. Three existing tests
  (`onboarding`, `back-navigation`, `signup-flow`) still fail their older
  employment/flow assertions. The same failures were reproduced against HEAD
  source without modifying the working files; these are not navigation-frame
  regressions. They were left unchanged in this task.
- Config-plugin introspection using the installed Expo CLI.
- 56 source-rendered previews of Jobs, Board (active and closed), job details,
  application confirmation and resume preview at widths 320/390 and bottom
  insets 0/24/34/48. Checked opaque system-area bounds, notification alignment,
  no horizontal overflow and tab buttons above the system area.

Before release, verify a rebuilt app on Android gesture and three-button modes,
an iPhone with a home indicator, keyboard open/close, sheets/dropdowns, nested
dialogs, app background/foreground, rotation where supported, checkout return,
and entry/exit from native video full-screen. OS-owned media controllers,
permission prompts and external browser windows must be checked on devices;
browser-rendered previews do not execute those native surfaces. No Android SDK,
ADB-connected device or iOS runtime was available during this source audit.

References: [React Native Modal](https://reactnative.dev/docs/modal),
[Android edge-to-edge guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
