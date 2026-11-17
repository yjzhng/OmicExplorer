# Build the app from this clone and install it - no SmartScreen prompt, since nothing is downloaded
# through a browser (no Mark of the Web). Run again to update: pulls, rebuilds, replaces.
#   powershell -ExecutionPolicy Bypass -File scripts\install-from-source.ps1
# Needs git and Node.js. Installs per user (no admin) with a Start menu shortcut.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent) # repo root (scripts\... -> ..)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Needs Node.js - https://nodejs.org' }

# Update the clone first, unless it has local changes (then build what's there).
git diff --quiet; $clean = $LASTEXITCODE -eq 0
git diff --cached --quiet; $clean = $clean -and $LASTEXITCODE -eq 0
if ($clean) {
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }
} else {
  Write-Host 'Local changes in the clone: skipping git pull, building as is.'
}

npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run package:dir
if ($LASTEXITCODE -ne 0) { throw 'build failed' }

$name = node -p "require('./package.json').productName"
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item 'dist\win-unpacked' $dest -Recurse

$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$shortcut.TargetPath = Join-Path $dest "$name.exe"
$shortcut.WorkingDirectory = $dest
$shortcut.Save()
Write-Host "Installed: $dest (Start menu: $name)"
