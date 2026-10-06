$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
$zip = Join-Path $dist "arxiv-pdf-translate-$version.zip"
$temp = Join-Path $dist "package"

if (Test-Path $temp) {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
if (!(Test-Path $dist)) {
  New-Item -ItemType Directory -Path $dist | Out-Null
}
if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

New-Item -ItemType Directory -Path $temp | Out-Null

Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $temp
Copy-Item -LiteralPath (Join-Path $root "src") -Destination $temp -Recurse
Copy-Item -LiteralPath (Join-Path $root "icons") -Destination $temp -Recurse
Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination $temp

Remove-Item -LiteralPath (Join-Path $temp "icons\make_icons.py") -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $zip -Force
Remove-Item -LiteralPath $temp -Recurse -Force

Write-Host "Built $zip"
Write-Host "For development, load the repository folder itself via chrome://extensions -> Load unpacked."
