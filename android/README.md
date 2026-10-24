# WinZal for Android

The Android version is the **floating Dynamic Island**, not a dashboard app.
Launching WinZal asks for the two Android permissions it needs, starts the island
service and closes its own window immediately.

## What it does

- A small black capsule floats above other apps, centered at the top.
- With no music it shows the clock.
- With music it shows the current cover and title, with a tiny equalizer.
- Tap the capsule to expand:
  - title and artist
  - progress / seek
  - previous, play/pause, next
  - **Media access** (Notification Access settings)
  - **Close** (stops the island)
- Tapping the launcher icon again expands the running island.
- Automatic session switching:
  - the first player that starts playing stays on screen
  - if it pauses, the next playing player takes over
- 30 fps equalizer, 1 s media poll, no background JSON/network polling except lyrics
  are not fetched in the overlay.

## Required permissions

1. **Display over other apps** — needed for the floating capsule.
   The app opens that Android setting on first launch.
2. **Notification Access** — lets the island read the playing song.
   Expand the pill and tap **Media access**, then enable WinZal.

No account, no data upload. The media metadata stays in memory.

## What Android cannot support

These are Windows-only in the desktop app:

- ETW FPS and Lenovo/GPU temperature sensors.
- Windows Media source-app launching.
- Discord local RPC (Android has no Discord IPC socket). An OAuth2 + Gateway
  presence bridge is possible, as some Android music apps do, but it is not part
  of this build.
- Native Wi-Fi/Bluetooth toggles (Android restricts apps from toggling them).
- System tray, autostart, Windows notch overlay, file Shelf/clipboard bridge.

Timer, notes and the About dashboard were removed in the island-only version.
The 1.0 APK is intentionally tiny (under 200 KB before this change, similarly
small after) and has no Compose/AndroidX dependencies, so it stays light on a
6 GB Android 13 phone.

## Build

Requirements: Android SDK 36, JDK 17+ (Android Studio JBR is fine), Gradle 9.x.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
gradle -p android assembleRelease
```

APK:

```
android/app/build/outputs/apk/release/app-release.apk
```

It is signed with the local debug key for sideloading. Replace the signing config
with your own key before publishing to a store.
