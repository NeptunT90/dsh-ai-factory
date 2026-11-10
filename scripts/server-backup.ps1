#requires -Version 5.1
<#
.SYNOPSIS
  Download a consistent PGlite/PostgreSQL backup from the sync server.
#>
param(
  [string]$Url = 'http://127.0.0.1:8787',
  [string]$OutFile = '',
  [string]$Token = $env:SYNC_TOKEN
)

$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'SYNC_TOKEN не задан (параметр -Token или env).' }
if (-not $OutFile) {
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $OutFile = Join-Path (Get-Location) "dsh-ai-factory-sync-backup-$stamp.tar.gz"
}
$headers = @{ Authorization = "Bearer $Token" }
$response = Invoke-WebRequest -Uri "$($Url.TrimEnd('/'))/v1/admin/backup" -Headers $headers -UseBasicParsing -TimeoutSec 120 -OutFile $OutFile
$hash = (Get-FileHash -LiteralPath $OutFile -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestFile = "$OutFile.manifest.json"
Write-Host "Backup: $OutFile" -ForegroundColor Green
if ($response.Headers['X-Backup-Manifest']) {
  $raw = [Convert]::FromBase64String(($response.Headers['X-Backup-Manifest'] -join ''))
  [IO.File]::WriteAllBytes($manifestFile, $raw)
  Write-Host "Manifest: $manifestFile"
}
Write-Host "SHA256: $hash"
