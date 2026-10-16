# Gives a GitHub repo the secrets Wisp's release workflow signs and builds the
# apps with, from what's already on this PC: the release key that
# make-release-key.ps1 made, and the Google sign-in client for YouTube Music.
# Use it when releases move to another repo (or a fork wants signed builds).
#
#   powershell -ExecutionPolicy Bypass -File set-release-secrets.ps1 [-Repo owner/name]
#
# Nothing is printed; the values go straight from this PC to GitHub.
param(
    [string]$Repo = "picovrfbt/WispOS"
)
$ErrorActionPreference = "Stop"

$props = Join-Path $env:USERPROFILE ".gradle\gradle.properties"
if (-not (Test-Path $props)) { throw "No ${props}: make the release key first (make-release-key.ps1)" }
$settings = @{}
foreach ($line in Get-Content $props) {
    if ($line -match '^\s*(wisp\.[A-Za-z]+)\s*=\s*(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim() }
}

function Set-Secret($name, $value) {
    if (-not $value) { Write-Host "Skipped $name (not set on this PC)"; return }
    $value | gh secret set $name --repo $Repo
    if ($LASTEXITCODE -ne 0) { throw "gh secret set $name failed" }
    Write-Host "Set $name"
}

$store = $settings["wisp.keystore"]
if (-not $store -or -not (Test-Path $store)) { throw "The release key wasn't found (wisp.keystore in $props)" }
Set-Secret "WISP_KEYSTORE_B64" ([Convert]::ToBase64String([IO.File]::ReadAllBytes($store)))
Set-Secret "WISP_KEYSTORE_PASSWORD" $settings["wisp.keystorePassword"]
Set-Secret "WISP_GOOGLE_CLIENT_ID" $settings["wisp.googleClientId"]
Set-Secret "WISP_GOOGLE_CLIENT_SECRET" $settings["wisp.googleClientSecret"]
Write-Host "Done: $Repo's release workflow can sign the apps and sign in to YouTube Music."
