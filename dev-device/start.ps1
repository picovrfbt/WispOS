# Live Car Thing simulator: the real wisp-daemon on this PC (logged into your
# Spotify, using this PC's internet instead of the phone tether) plus the real
# UI in a device frame with a working dial and buttons.
#
#   powershell -ExecutionPolicy Bypass -File dev-device\start.ps1 [-FakePhone]
#
# -FakePhone also runs a stand-in for the Car Thing Nav phone app that replays
# a drive, so navigation shows up without a phone. Then open
# http://localhost:5173/device.html. Ctrl+C stops everything.

param([switch]$FakePhone)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$daemonDir = Join-Path $root 'wisp-daemon'
$uiDir = Join-Path $root 'wisp-ui'
$exe = Join-Path $daemonDir 'wisp-daemon-dev.exe'

$go = (Get-Command go -ErrorAction SilentlyContinue).Source
if (-not $go) { $go = 'C:\Program Files\Go\bin\go.exe' }

Write-Host 'Building wisp-daemon for this PC...'
Push-Location $daemonDir
try { & $go build -o $exe ./cmd/wisp-daemon; if ($LASTEXITCODE) { throw 'daemon build failed' } }
finally { Pop-Location }

if (-not (Test-Path (Join-Path $uiDir 'node_modules'))) {
  Write-Host 'Installing UI dependencies...'
  Push-Location $uiDir
  try { npm ci --no-audit --no-fund } finally { Pop-Location }
}

$fake = $null
if ($FakePhone) {
  $fakeExe = Join-Path $daemonDir 'fake-nav-phone.exe'
  Push-Location $daemonDir
  try { & $go build -o $fakeExe ./cmd/fake-nav-phone; if ($LASTEXITCODE) { throw 'fake phone build failed' } }
  finally { Pop-Location }
  $fake = Start-Process -FilePath $fakeExe -ArgumentList '-speedup', '3' -NoNewWindow -PassThru
  Write-Host "fake phone driving on ws://127.0.0.1:3679/nav (pid $($fake.Id))"
}

$config = Join-Path $PSScriptRoot 'config'
$daemon = Start-Process -FilePath $exe -ArgumentList '--config_dir', "`"$config`"" `
  -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
Write-Host "wisp-daemon running (pid $($daemon.Id)) on http://127.0.0.1:3678"
Write-Host 'Simulator: http://localhost:5173/device.html'

try {
  Push-Location $uiDir
  npm run dev -- --port 5173 --strictPort --open /device.html
}
finally {
  Pop-Location
  if (-not $daemon.HasExited) { Stop-Process -Id $daemon.Id }
  if ($fake -and -not $fake.HasExited) { Stop-Process -Id $fake.Id }
}
