# Build the project website from site/ (Jekyll source) into docs/ (published).
#
#   powershell -File tools/build-docs.ps1
#
# Prerequisites (one-time):
#   - Ruby (https://rubyinstaller.org/) then:  gem install jekyll bundler
#
# Preview locally with live reload (does NOT touch docs/):
#   jekyll serve --source site --destination site/_site

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command jekyll -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: jekyll not found on PATH." -ForegroundColor Red
    Write-Host "Install Ruby, then run: gem install jekyll bundler" -ForegroundColor Yellow
    exit 1
}

jekyll build --source site --destination docs
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: jekyll build failed" -ForegroundColor Red; exit 1 }

Write-Host "Built site/ -> docs/  (commit docs/ to publish)" -ForegroundColor Green
