# WinZal local updater: build a portable exe, replace the installed one, relaunch.
# No NSIS installer, no updater signing, no GitHub release.
#
# Usage:
#   .\local-build.ps1                  # release build + update installed app
#   .\local-build.ps1 -DebugBuild      # debug build for testing
#   .\local-build.ps1 -SkipBuild       # reuse the last build, just replace/relaunch
#   .\local-build.ps1 -NoStart         # build/replace but do not relaunch
#
# The installed app stays at %LOCALAPPDATA%\WinZal\winzal.exe, so autostart,
# Start Menu/Desktop shortcuts and the FPS helper task keep working.
[CmdletBinding()]
param(
    [switch]$DebugBuild,
    [switch]$SkipBuild,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$installedDir = Join-Path $env:LOCALAPPDATA "WinZal"
$installedExe = Join-Path $installedDir "winzal.exe"
$flavor = if ($DebugBuild) { "debug" } else { "release" }
$targetExe = Join-Path $root "src-tauri\target\$flavor\winzal.exe"
$started = Get-Date

Write-Host "WinZal local updater ($flavor)" -ForegroundColor Cyan

if ($SkipBuild) {
    if (-not (Test-Path $targetExe)) {
        throw "No $flavor build found at $targetExe. Run without -SkipBuild first."
    }
    Write-Host "Skipping build; using $targetExe"
} else {
    Write-Host "Building local $flavor exe (no installer, no signing)..."
    $tauriArgs = if ($DebugBuild) {
        @("tauri", "build", "--debug", "--no-bundle")
    } else {
        @("tauri", "build", "--no-bundle")
    }
    & npx.cmd @tauriArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed. The installed app was not touched."
    }
    if (-not (Test-Path $targetExe)) {
        throw "Build finished but $targetExe was not found."
    }
}

if (-not (Test-Path $installedExe)) {
    throw "Installed WinZal not found at $installedExe."
}

Write-Host "Closing WinZal and the FPS helper..."
Get-Process winzal -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
schtasks /End /TN WinZalFpsHelper 2>$null | Out-Null
for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-Process winzal -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
}
if (Get-Process winzal -ErrorAction SilentlyContinue) {
    throw "WinZal is still running. Close it and run the script again."
}

$backupDir = Join-Path $installedDir "backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$version = (Get-Item $installedExe).VersionInfo.FileVersion
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $backupDir "winzal-$version-$stamp.exe"
Copy-Item $installedExe $backup -Force

# Keep only the three newest backups.
Get-ChildItem $backupDir -Filter "winzal-*.exe" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 3 |
    Remove-Item -Force -ErrorAction SilentlyContinue

Copy-Item $targetExe $installedExe -Force
Write-Host "Updated $installedExe" -ForegroundColor Green
Write-Host "Backup: $backup"

if (-not $NoStart) {
    Start-Process -FilePath $installedExe
    Write-Host "Relaunched WinZal." -ForegroundColor Green
}

$seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Write-Host "Done in $seconds s."
