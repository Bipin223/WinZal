@echo off
REM Live design mode: the real WinZal window with instant CSS/React reload.
REM Changes here are temporary; run local-build.cmd when you want them in the
REM installed app. Close this window (or press Ctrl+C) to stop.
cd /d "%~dp0"
call npm run tauri dev
echo.
pause
