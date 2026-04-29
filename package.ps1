# Build a Chrome Web Store-ready zip from this repo.
# Output: dist/gist-organizer-{version}.zip (version pulled from manifest.json).
#
# Usage:  pwsh ./package.ps1   (or right-click > Run with PowerShell)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# --- Read version from manifest ---
$manifest = Get-Content -Raw -Path 'manifest.json' | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw 'Could not read version from manifest.json' }

# --- Output paths ---
$dist     = 'dist'
$buildDir = Join-Path $dist 'build'
$zipPath  = Join-Path $dist ("gist-organizer-$version.zip")

if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
if (Test-Path $zipPath)  { Remove-Item -Force $zipPath }
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

# --- Files Chrome actually loads (allowlist; safer than excluding) ---
$files = @(
    'manifest.json',
    'content.js',
    'hide.css',
    'popup.html',
    'popup.css',
    'popup.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png'
)

foreach ($f in $files) {
    if (-not (Test-Path $f)) { throw "Missing required file: $f" }
    $dest    = Join-Path $buildDir $f
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }
    Copy-Item -Path $f -Destination $dest
}

# Vendored CodeMirror — referenced wholesale by manifest, copy the directory.
Copy-Item -Recurse 'codemirror' (Join-Path $buildDir 'codemirror')

# --- Sanity-check every path the manifest references actually exists ---
$cssRefs = @($manifest.content_scripts[0].css)
$jsRefs  = @($manifest.content_scripts[0].js)
$iconRefs = @($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value })
$actionIconRefs = @($manifest.action.default_icon.PSObject.Properties | ForEach-Object { $_.Value })
$popupRef = @($manifest.action.default_popup)

$allRefs = $cssRefs + $jsRefs + $iconRefs + $actionIconRefs + $popupRef
foreach ($r in $allRefs) {
    $bundled = Join-Path $buildDir $r
    if (-not (Test-Path $bundled)) {
        throw "Manifest references '$r' but it's not in the build."
    }
}

# --- Zip ---
Compress-Archive -Path "$buildDir/*" -DestinationPath $zipPath -Force

$sizeKB = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Output "Built v$version package:"
Write-Output "  $zipPath  ($sizeKB KB)"
Write-Output ''
Write-Output 'Upload this zip at: https://chrome.google.com/webstore/devconsole'
