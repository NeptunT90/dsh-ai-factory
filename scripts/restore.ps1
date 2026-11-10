#requires -Version 5.1
<#
.SYNOPSIS
  Restore AI Factory data from a backup made by backup.ps1.
#>
param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dataDir = Join-Path $dshHome 'ai-factory'
$backup = [IO.Path]::GetFullPath($BackupDir)
if (-not (Test-Path $backup)) { throw "Резервная копия не найдена: $backup" }

$snapshot = Join-Path $backup 'factory.db'
if (-not (Test-Path $snapshot)) { throw "В резервной копии нет factory.db: $backup" }
if (-not $Force) {
  Write-Warning 'Остановите DSH перед восстановлением, иначе открытая БД может перезаписать восстановленные данные.'
  $answer = Read-Host 'Продолжить? [y/N]'
  if ($answer -notmatch '^(?i)y') { Write-Host 'Отменено.'; exit 1 }
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$current = Join-Path $dataDir 'factory.db'
if (Test-Path $current) {
  $safety = "$current.pre-restore-$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  Copy-Item $current $safety -Force
  Write-Host "[restore] текущая БД сохранена: $safety"
}
Copy-Item $snapshot $current -Force
foreach ($name in @('config.json', 'settings.json')) {
  $source = Join-Path $backup $name
  if (Test-Path $source) { Copy-Item $source (Join-Path $dataDir $name) -Force }
}
Write-Host "Данные восстановлены в $dataDir" -ForegroundColor Green
