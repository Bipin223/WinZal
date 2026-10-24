# WinZal for Android

A lean companion to WinZal for Windows. It keeps the calm island look and the
parts Android can genuinely support.

## What works

- Island-style home card with clock, date, weather and battery.
- Now Playing from any app that exposes a MediaSession:
  - title, artist, album art
  - play / pause / previous / next
  - progress and seek
- Automatic session switching:
  - the first player that starts playing stays on screen
  - if it pauses, WinZal switches to the next playing app
- Synced lyrics from LRCLIB (line by line), cached per track.
- Focus timer.
- Notes saved locally.
- About card with GitHub/Website links and the version.
- Smooth, dependency-free UI; release APK is about **186 KB**.

## Needs one permission

**Notification Access** is required to read the current media session. The Music
tab has a button that opens the exact Android setting. Nothing is uploaded; the
metadata is only kept in memory.

## What Android cannot do

These are Windows-only in the desktop app, so they are intentionally omitted:

- ETW FPS and Lenovo/GPU temperature sensors.
- PowerShell/Windows Media session source-app launching.
- Discord local RPC (Android has no Discord IPC socket).
- Native Wi-Fi/Bluetooth toggles (Android restricts apps from toggling them).
- System tray, autostart, Windows notch overlay, file Shelf/clipboard bridge.

A future version could add an optional floating overlay (`SYSTEM_ALERT_WINDOW`)
and a home-screen widget, but the app is deliberately a normal, low-memory
Android app today.

## Build

Requirements: Android SDK 36, JDK 17+ (Android Studio JBR is fine), Gradle 9.x.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
gradle -p android assembleRelease
```

The release APK is written to:

```
android/app/build/outputs/apk/release/app-release.apk
```

It is signed with the local debug key so it can be sideloaded. Replace the
signing config with your own key before publishing to a store.
