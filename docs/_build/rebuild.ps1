# rebuild.ps1 — regenerate docs/PROJECT.pdf from PROJECT.md.
#
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File docs/_build/rebuild.ps1
#
# Pipeline:
#   1. marked CLI: PROJECT.md → _build/body.html (GitHub-flavored)
#   2. build-pdf.js: wrap body in cover page + style.css → _build/PROJECT.html
#   3. Chrome headless: _build/PROJECT.html → PROJECT.pdf
#
# Requires:
#   • Node.js + npx (for marked)
#   • Google Chrome installed at the standard location
#
# Output: docs/PROJECT.pdf (overwritten)

$ErrorActionPreference = "Stop"

$root   = Split-Path -Parent $PSScriptRoot
$src    = Join-Path $root "PROJECT.md"
$body   = Join-Path $PSScriptRoot "body.html"
$html   = Join-Path $PSScriptRoot "PROJECT.html"
$pdf    = Join-Path $root "PROJECT.pdf"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"

if (-not (Test-Path $src))    { throw "Missing source: $src" }
if (-not (Test-Path $chrome)) { throw "Chrome not found at: $chrome" }

Write-Host "1. markdown -> body.html (marked)"
Push-Location $root
try {
  & npx --yes marked -i $src -o $body --gfm
  if ($LASTEXITCODE -ne 0) { throw "marked failed" }
} finally {
  Pop-Location
}

Write-Host "2. body.html -> PROJECT.html (wrap in template)"
& node (Join-Path $PSScriptRoot "build-pdf.js")
if ($LASTEXITCODE -ne 0) { throw "build-pdf.js failed" }

Write-Host "3. PROJECT.html -> PROJECT.pdf (Chrome headless)"
$htmlUrl = "file:///" + ($html -replace '\\', '/' -replace ' ', '%20')
& $chrome --headless=new --disable-gpu --print-to-pdf="$pdf" "$htmlUrl" 2>&1 | Out-Null

if (-not (Test-Path $pdf)) { throw "Chrome did not write the PDF" }

$size = (Get-Item $pdf).Length
Write-Host ("Done: {0} ({1:N1} KB)" -f $pdf, ($size / 1024))
