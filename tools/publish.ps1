# One-command local release for Arxiv PDF Translate.
#
#   powershell -File tools/publish.ps1 -Version 0.5.0
#   powershell -File tools/publish.ps1 -Version 0.5.0 -Notes "本次更新说明"
#
# Steps: build payload + code patch (tools/build-release.ps1) -> build the
# installer with Inno Setup -> tag & push -> create/update the GitHub Release
# (gh) -> write update.json and push it to the default branch.
#
# Prerequisites (one-time):
#   - MinGW-w64 gcc on PATH (to build the native launcher; skipped if the exe exists)
#   - Inno Setup 6 (auto-detected: PATH / %LOCALAPPDATA%\Programs / Program Files)
#   - GitHub CLI: `gh auth login`  (behind a proxy: set $env:HTTPS_PROXY first)
#   - server/server.py APP_VERSION already bumped to -Version
#   - engine/ present locally (so the installer bundles it)

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$PrevTag = "",
    [string]$Notes = "",
    [string]$Repo = "",
    [string]$Branch = "main"
)

# Native tools (gh/git/iscc) write progress to stderr; keep going and check exit codes.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail([string]$message) { Write-Host "ERROR: $message" -ForegroundColor Red; exit 1 }
function Assert-Ok([string]$what) { if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit $LASTEXITCODE)" } }

$tag = "v$Version"

# ---- 0. prerequisites -------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git not found" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GitHub CLI (gh) not found; install and run 'gh auth login'" }
$null = & gh auth status 2>&1
if ($LASTEXITCODE -ne 0) { Fail "gh is not authenticated; run 'gh auth login' (set `$env:HTTPS_PROXY first if behind a proxy)" }
if (-not $Repo) { $Repo = (& gh repo view --json nameWithOwner -q .nameWithOwner 2>$null) }
$Repo = ("$Repo").Trim()
if (-not $Repo) { Fail "cannot determine repo; pass -Repo owner/name" }
if (-not (Test-Path "engine")) { Fail "engine/ not found; the installer must bundle the engine" }

# ---- 1. version / engine version -------------------------------------------
$m = Select-String -Path "server/server.py" -Pattern 'APP_VERSION\s*=\s*"([^"]+)"' -ErrorAction SilentlyContinue
if (-not $m) { Fail "APP_VERSION not found in server/server.py" }
$serverVersion = $m.Matches[0].Groups[1].Value
if ($serverVersion -ne $Version) { Fail "server/server.py APP_VERSION=$serverVersion but -Version=$Version; bump it first" }
$engine = ""
if (Test-Path "engine/VERSION") { $engine = (Get-Content "engine/VERSION" -Raw).Trim() }
else { Write-Host "WARNING: engine/VERSION not found; engine_version will be empty" }

# ---- 2. previous tag (patch base) ------------------------------------------
if (-not $PrevTag) {
    $PrevTag = (git tag --sort=-v:refname | Where-Object { $_ -match '^v' -and $_ -ne $tag } | Select-Object -First 1)
}
Write-Host "publishing $tag  (prev=$PrevTag  engine=$engine)"

# ---- 3. build payload + patch ----------------------------------------------
& "$PSScriptRoot/build-release.ps1" -Version $Version -PrevTag $PrevTag
Assert-Ok "build-release.ps1"

# ---- 4. build installer (Inno Setup) ---------------------------------------
$iscc = "iscc"
if (-not (Get-Command iscc -ErrorAction SilentlyContinue)) {
    foreach ($p in @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
                     "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
                     "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $p) { $iscc = $p; break }
    }
}
Write-Host "using Inno Setup compiler: $iscc"
& $iscc "/DVersion=$Version" "installer\ArxivPdfTranslate.iss"
Assert-Ok "Inno Setup (iscc)"

# ---- 5. checksums -----------------------------------------------------------
$out = "dist/release"
Get-ChildItem "$out" -File | Where-Object { $_.Name -ne "SHA256SUMS" } | ForEach-Object {
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
} | Set-Content -Path "$out/SHA256SUMS" -Encoding ascii

# ---- 6. tag + release -------------------------------------------------------
if (-not (git tag --list $tag)) { git tag $tag; Assert-Ok "git tag" }
git push origin $tag
Assert-Ok "git push tag"

$assets = @(Get-ChildItem "$out" -File | ForEach-Object { $_.FullName })
if (-not $Notes) { $Notes = "Release $tag" }
$null = & gh release view $tag 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "release $tag exists; uploading assets"
    & gh release upload $tag @assets --clobber
    Assert-Ok "gh release upload"
} else {
    & gh release create $tag @assets --title $tag --notes $Notes
    Assert-Ok "gh release create"
}

# ---- 7. update.json ---------------------------------------------------------
$installer = "ArxivPdfTranslate-Setup-v$Version.exe"
$patchName = "arxiv-pdf-translate-v$Version-patch-from-$($PrevTag.TrimStart('v')).zip"
$base = "https://github.com/$Repo/releases/download/$tag"
$obj = [ordered]@{
    version        = $Version
    engine_version = $engine
    notes          = $Notes
    installer      = [ordered]@{ url = "$base/$installer" }
}
if ($PrevTag -and (Test-Path "$out/$patchName")) {
    $obj.patch = [ordered]@{
        from   = $PrevTag.TrimStart("v")
        url    = "$base/$patchName"
        sha256 = (Get-FileHash "$out/$patchName" -Algorithm SHA256).Hash.ToLower()
    }
}
$json = ($obj | ConvertTo-Json -Depth 5)
[System.IO.File]::WriteAllText((Join-Path $root "update.json"), $json, (New-Object System.Text.UTF8Encoding($false)))

git add update.json
Assert-Ok "git add update.json"
git commit -m "chore(release): update manifest for $tag"
Assert-Ok "git commit update.json"
git push origin $Branch
Assert-Ok "git push manifest"

Write-Host "published $tag" -ForegroundColor Green
