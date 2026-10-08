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
#   - Inno Setup 6 (iscc on PATH, or the default install dir)
#   - GitHub CLI: `gh auth login`
#   - server/server.py APP_VERSION already bumped to -Version
#   - engine/ present locally (so the installer bundles it)

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$PrevTag = "",
    [string]$Notes = "",
    [string]$Repo = "",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$tag = "v$Version"

# ---- 0. prerequisites -------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git not found" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) not found; install and run 'gh auth login'" }
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "gh is not authenticated; run 'gh auth login'" }
if (-not $Repo) { $Repo = (& gh repo view --json nameWithOwner -q .nameWithOwner).Trim() }
if (-not $Repo) { throw "cannot determine repo; pass -Repo owner/name" }
if (-not (Test-Path "engine")) { throw "engine/ not found; the installer must bundle the engine" }

# ---- 1. version / engine version -------------------------------------------
$svMatch = Select-String -Path "server/server.py" -Pattern 'APP_VERSION\s*=\s*"([^"]+)"'
if (-not $svMatch) { throw "APP_VERSION not found in server/server.py" }
$serverVersion = $svMatch.Matches[0].Groups[1].Value
if ($serverVersion -ne $Version) {
    throw "server/server.py APP_VERSION=$serverVersion but -Version=$Version; bump APP_VERSION first"
}
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

# ---- 4. build installer (Inno Setup) ---------------------------------------
$iscc = "iscc"
if (-not (Get-Command iscc -ErrorAction SilentlyContinue)) {
    foreach ($p in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
                     "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
        if (Test-Path $p) { $iscc = $p; break }
    }
}
& $iscc "/DVersion=$Version" "installer\ArxivPdfTranslate.iss"

# ---- 5. checksums -----------------------------------------------------------
$out = "dist/release"
Get-ChildItem "$out" -File | Where-Object { $_.Name -ne "SHA256SUMS" } | ForEach-Object {
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
} | Set-Content -Path "$out/SHA256SUMS" -Encoding ascii

# ---- 6. tag + release -------------------------------------------------------
if (-not (git tag --list $tag)) { git tag $tag }
git push origin $tag

$assets = @(Get-ChildItem "$out" -File | ForEach-Object { $_.FullName })
if (-not $Notes) { $Notes = "Release $tag" }
& gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host "release $tag exists; uploading assets"
    & gh release upload $tag @assets --clobber
} else {
    & gh release create $tag @assets --title $tag --notes $Notes
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
($obj | ConvertTo-Json -Depth 5) | Set-Content -Path update.json -Encoding utf8

git add update.json
git commit -m "chore(release): update manifest for $tag"
git push origin $Branch

Write-Host "published $tag"
