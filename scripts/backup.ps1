#requires -Version 5.1
<#
.SYNOPSIS
  Create a consistent snapshot of the AI Factory database and profile config.
#>
param(
  [string]$Profile = 'desktop',
  [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dataDir = Join-Path $dshHome 'ai-factory'
$profileDir = Join-Path $dshHome "profiles\$Profile"
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
if (-not $OutputDir) { $OutputDir = Join-Path $repo "backups\factory-$stamp" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Test-Path $dataDir) {
  $snapshot = Join-Path $OutputDir 'factory.db'
  $db = Join-Path $dataDir 'factory.db'
  if (Test-Path $db) {
    $node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($node) {
      & $node.Source (Join-Path $PSScriptRoot 'snapshot-db.mjs') $db $snapshot
      if ($LASTEXITCODE -ne 0) { throw 'Не удалось сделать консистентный SQLite-снимок.' }
    } else {
      Copy-Item $db $snapshot -Force
      Write-Warning 'node не найден: сделана обычная копия файла БД; для WAL-режима лучше остановить DSH.'
    }
  }
  foreach ($name in @('config.json', 'settings.json')) {
    $source = Join-Path $dataDir $name
    if (Test-Path $source) { Copy-Item $source (Join-Path $OutputDir $name) -Force }
  }
  Write-Host "[backup] данные: $OutputDir"
} else {
  Write-Host '[backup] каталог данных отсутствует; копирую только конфигурацию.'
}

$profileBackup = Join-Path $OutputDir 'profile'
New-Item -ItemType Directory -Force -Path $profileBackup | Out-Null
foreach ($name in @('package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml')) {
  $source = Join-Path $profileDir $name
  if (Test-Path $source) { Copy-Item $source (Join-Path $profileBackup $name) -Force }
}
Write-Host "[backup] профиль: $profileBackup"

$manifestPath = Join-Path $OutputDir 'manifest.json'
$snapshotPath = Join-Path $OutputDir 'factory.db'
if (Test-Path $snapshotPath) {
  $nodeForManifest = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($nodeForManifest) {
    $pluginPackage = Join-Path $repo 'plugin\package.json'
    & $nodeForManifest.Source (Join-Path $PSScriptRoot 'backup-manifest.mjs') $snapshotPath $manifestPath $pluginPackage
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать manifest.json.' }
  } else {
    Write-Warning 'node не найден: manifest.json не создан.'
  }
}

$archivePath = "$OutputDir.tar.gz"
$tar = Get-Command 'tar.exe' -ErrorAction SilentlyContinue
if (-not $tar) { $tar = Get-Command 'tar' -ErrorAction SilentlyContinue }
if ($tar) {
  & $tar.Source -czf $archivePath -C $OutputDir .
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать tar.gz архив.' }
  Write-Host "[backup] архив: $archivePath"
} else {
  Write-Warning 'tar не найден: архив не создан.'
}
Write-Host "[backup] manifest: $manifestPath"
