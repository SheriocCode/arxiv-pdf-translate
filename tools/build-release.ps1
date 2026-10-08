# Build release assets for Arxiv PDF Translate.
#
#   powershell -File tools/build-release.ps1 -Version 0.5.0 [-PrevTag v0.4.1]
#
# Produces:
#   dist/payload/                                        (full app + engine; fed to Inno Setup)
#   dist/release/arxiv-pdf-translate-v<Version>-patch-from-<from>.zip  (only with -PrevTag)
#   dist/release/SHA256SUMS
#
# The engine ships only inside the installer (Setup.exe); there is no separate
# full zip. The zip root mirrors the project layout (paths relative to the repo
# root), which is what server.py expects when applying an update.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$PrevTag = "",
    [string]$OutDir = "dist/release",
    [switch]$SkipPayload
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Application files that make up a runnable install (path relative to repo root).
$appItems = @(
    "server/server.py",
    "server/make_thumb.py",
    "server/requirements.txt",
    "server/config.example.json",
    "server/web",
    "src",
    "icons",
    "manifest.json",
    "README.md",
    "launcher/ArxivPdfTranslate.exe",
    "launcher/build-native-launcher.bat"
)

# Paths delivered via patches (code only; launcher/engine stay full-package only).
$patchFilter = @("server/", "src/", "icons/")
$patchFiles = @("manifest.json")

function Copy-Rel([string]$rel, [string]$destRoot) {
    $src = Join-Path $root $rel
    if (-not (Test-Path $src)) { return }
    $dst = Join-Path $destRoot $rel
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    if ((Get-Item $src).PSIsContainer) {
        Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
    } else {
        Copy-Item -LiteralPath $src -Destination $dst -Force
    }
}

# Fail loudly if a package is missing something required or leaks something private.
function Assert-NoForbidden([string]$tree, [string]$label) {
    foreach ($f in @("server/config.json", "server/server.log", "storage", "server/__pycache__")) {
        if (Test-Path (Join-Path $tree $f)) { throw "$label contains forbidden path: $f" }
    }
}

function Assert-FullPackage([string]$tree) {
    $required = @(
        "server/server.py",
        "server/web/console.html",
        "server/web/console.js",
        "manifest.json",
        "launcher/ArxivPdfTranslate.exe"
    )
    foreach ($r in $required) {
        if (-not (Test-Path (Join-Path $tree $r))) { throw "full package missing required file: $r" }
    }
    Assert-NoForbidden $tree "full package"
    if (Test-Path "engine") {
        if (-not (Test-Path (Join-Path $tree "engine"))) { throw "engine/ exists but was not included in the full package" }
    }
}

# Make sure the native launcher exists (build it when gcc is available).
if (-not (Test-Path "launcher/ArxivPdfTranslate.exe")) {
    if (Get-Command gcc -ErrorAction SilentlyContinue) {
        & "launcher/build-native-launcher.bat"
    } else {
        throw "launcher/ArxivPdfTranslate.exe is missing and gcc (MinGW-w64) was not found."
    }
}

if (Test-Path $OutDir) { Remove-Item -LiteralPath $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir | Out-Null

# ---- full payload (consumed by the Inno Setup installer) --------------------
# The engine is bundled exactly once: inside the installer (no separate full.zip).
if ($SkipPayload) {
    $payload = Join-Path (Split-Path $OutDir -Parent) "payload"
    if (Test-Path $payload) { Remove-Item -LiteralPath $payload -Recurse -Force }
    Write-Host "skip payload (patch-only build)"
} else {
    $payload = Join-Path (Split-Path $OutDir -Parent) "payload"
    if (Test-Path $payload) { Remove-Item -LiteralPath $payload -Recurse -Force }
    New-Item -ItemType Directory -Path $payload | Out-Null
    foreach ($item in $appItems) { Copy-Rel $item $payload }
    if (Test-Path "engine") { Copy-Item -LiteralPath "engine" -Destination (Join-Path $payload "engine") -Recurse -Force }
    Assert-FullPackage $payload
    Write-Host "staged payload: $payload"
}

# ---- patch package (code only) ---------------------------------------------
if ($PrevTag -ne "") {
    $from = $PrevTag.TrimStart("v")
    $patchName = "arxiv-pdf-translate-v$Version-patch-from-$from.zip"
    $changed = @(git diff --name-only --diff-filter=d "$PrevTag..HEAD")
    $deleted = @(git diff --name-only --diff-filter=D "$PrevTag..HEAD")

    $stageP = Join-Path $OutDir "_patch"
    New-Item -ItemType Directory -Path $stageP | Out-Null
    $included = 0
    foreach ($raw in $changed) {
        $f = ($raw -replace "\\", "/").Trim()
        if (-not $f) { continue }
        $ok = ($patchFiles -contains $f)
        if (-not $ok) {
            foreach ($prefix in $patchFilter) { if ($f.StartsWith($prefix)) { $ok = $true; break } }
        }
        if ($ok -and (Test-Path $f)) { Copy-Rel $f $stageP; $included++ }
    }
    $deleteList = @($deleted | ForEach-Object { ($_ -replace "\\", "/").Trim() } | Where-Object { $_ })
    $meta = [ordered]@{ version = $Version; from = $from; delete = $deleteList }
    $metaJson = ($meta | ConvertTo-Json -Depth 5)
    [System.IO.File]::WriteAllText((Join-Path $stageP "patch.json"), $metaJson, (New-Object System.Text.UTF8Encoding($false)))

    if ($included -eq 0 -and $deleteList.Count -eq 0) {
        Write-Host "no code changes since $PrevTag; skipping patch asset"
    } else {
        Assert-NoForbidden $stageP "patch package"
        Compress-Archive -Path (Join-Path $stageP "*") -DestinationPath (Join-Path $OutDir $patchName) -Force
        Write-Host "built $patchName ($included files)"
    }
    Remove-Item -LiteralPath $stageP -Recurse -Force
}

# ---- checksums --------------------------------------------------------------
$sums = @()
Get-ChildItem -Path $OutDir -Filter *.zip | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
    $sums += "$hash  $($_.Name)"
}
$sums | Set-Content -Path (Join-Path $OutDir "SHA256SUMS") -Encoding ascii
Write-Host "wrote SHA256SUMS"
