# Makes Wisp's release signing key, once. Android only installs an update
# signed with the same key as the app already on the phone, so this key signs
# every release of the Wisp app and the Drive Recorder from now on.
#
#   1. a keystore with a random password, in %USERPROFILE%\.wisp\
#   2. the settings Gradle signs release builds with, in ~/.gradle/gradle.properties
#   3. the same key as GitHub secrets, so the release workflow builds the APKs
#      (needs the gh CLI signed in; skipped with -NoGitHub)
#
# The password is never printed. Back the .wisp folder up somewhere safe: if
# the key is lost, no one can update their installed app again.
param(
    [string]$Repo = "picovrfbt/WispOS",
    [switch]$NoGitHub
)
$ErrorActionPreference = "Stop"

$dir = Join-Path $env:USERPROFILE ".wisp"
$store = Join-Path $dir "wisp-release.jks"
if (Test-Path $store) {
    Write-Host "There's already a release key at $store; not making another."
    exit 1
}

$keytool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin\keytool.exe" } else { "keytool" }
if ($env:JAVA_HOME -and -not (Test-Path $keytool)) { $keytool = "keytool" }

# letters and digits only, so it needs no escaping in gradle.properties
$chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

New-Item -ItemType Directory -Force $dir | Out-Null
& $keytool -genkeypair -v -keystore $store -storetype PKCS12 -alias wisp `
    -keyalg RSA -keysize 4096 -validity 36500 `
    -storepass $password -keypass $password `
    -dname "CN=Wisp, O=Wisp" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
Write-Host "Made the release key: $store"

$gradleDir = Join-Path $env:USERPROFILE ".gradle"
New-Item -ItemType Directory -Force $gradleDir | Out-Null
$props = Join-Path $gradleDir "gradle.properties"
$lines = @(
    "",
    "# Wisp's release signing key (wisp-companion/scripts/make-release-key.ps1)",
    "wisp.keystore=$($store -replace '\\', '/')",
    "wisp.keystorePassword=$password",
    "wisp.keyAlias=wisp"
)
Add-Content -Path $props -Value $lines -Encoding ascii
Write-Host "Gradle signs release builds with it: $props"

if (-not $NoGitHub) {
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($store)) | gh secret set WISP_KEYSTORE_B64 --repo $Repo
    if ($LASTEXITCODE -ne 0) { throw "gh secret set failed" }
    $password | gh secret set WISP_KEYSTORE_PASSWORD --repo $Repo
    if ($LASTEXITCODE -ne 0) { throw "gh secret set failed" }
    Write-Host "The release workflow has it too ($Repo secrets)."
}

Write-Host ""
Write-Host "Back up $dir now (a password manager or a USB stick)."
Write-Host "If it's lost, no one can update their installed Wisp app again."
