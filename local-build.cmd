@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-build.ps1" %*
echo.
pause
