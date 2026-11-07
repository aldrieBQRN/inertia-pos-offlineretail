# ============================================================
# zip-vendor.ps1 — One-time vendor/ upload helper
# Run this ONCE before first deploy to InfinityFree
# ============================================================
#
# USAGE:
#   PowerShell: .\zip-vendor.ps1
#
# Then:
#   1. Upload vendor.zip to InfinityFree File Manager → htdocs/
#   2. Right-click vendor.zip → Extract
#   3. Done — CI/CD will never touch vendor/ again

$src  = ".\vendor"
$dest = ".\vendor.zip"

if (Test-Path $dest) { Remove-Item $dest -Force }

Write-Host "📦 Zipping vendor/ ..." -ForegroundColor Cyan
Compress-Archive -Path $src -DestinationPath $dest -CompressionLevel Optimal

$sizeMB = [math]::Round((Get-Item $dest).Length / 1MB, 1)
Write-Host "✅ Created vendor.zip ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open InfinityFree File Manager"
Write-Host "  2. Navigate to htdocs/"
Write-Host "  3. Upload vendor.zip"
Write-Host "  4. Right-click vendor.zip → Extract Here"
Write-Host "  5. Delete vendor.zip from the server"

