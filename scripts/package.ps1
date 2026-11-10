#requires -Version 5.1
<#
.SYNOPSIS
  Build a release tarball for dsh-ai-factory.
.DESCRIPTION
  Builds the plugin, runs pnpm pack into dist/, verifies the archive contains
  only the installable package files, and writes SHA256SUMS.
#>
param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $repo 'plugin'
$packageJson = Join-Path $plugin 'package.json'
if (-not (Test-Path $packageJson)) { throw "Не найден $packageJson" }
$pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
if (-not $pnpm) { $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue }
if (-not $pnpm) { throw 'pnpm не найден в PATH.' }

Write-Host '[1/4] build'
Push-Location $repo
try {
  & $pnpm.Source --filter dsh-ai-factory build
  if ($LASTEXITCODE -ne 0) { throw "Сборка завершилась с кодом $LASTEXITCODE" }
} finally {
  Pop-Location
}

Remove-Item (Join-Path $OutDir "dsh-ai-factory-$version.tgz") -Force -ErrorAction SilentlyContinue
Write-Host '[2/4] pnpm pack'
Push-Location $plugin
try {
  & $pnpm.Source pack --pack-destination $OutDir
  if ($LASTEXITCODE -ne 0) { throw "pnpm pack завершился с кодом $LASTEXITCODE" }
} finally {
  Pop-Location
}

$tarball = Join-Path $OutDir "dsh-ai-factory-$version.tgz"
if (-not (Test-Path $tarball)) {
  $found = Get-ChildItem $OutDir -Filter "dsh-ai-factory-$version*.tgz" | Select-Object -First 1
  if (-not $found) { throw "Tarball не найден в $OutDir" }
  $tarball = $found.FullName
}

Write-Host '[3/4] verify archive'
& (Join-Path $PSScriptRoot 'verify-package.ps1') -Tarball $tarball
if ($LASTEXITCODE -ne 0) { throw 'Проверка архива не пройдена.' }

Write-Host '[4/4] checksums'
$hash = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant()
$name = Split-Path -Leaf $tarball
$sumFile = Join-Path $OutDir 'SHA256SUMS'
$lines = @()
if (Test-Path $sumFile) {
  $lines = @(Get-Content -LiteralPath $sumFile | Where-Object { $_ -and ($_ -notmatch [regex]::Escape($name)) })
}
$lines += "$hash  $name"
[IO.File]::WriteAllText($sumFile, (($lines -join ([char]10)) + [char]10), (New-Object Text.ASCIIEncoding))
$size = (Get-Item $tarball).Length
Write-Host ''
Write-Host "Готово: $tarball" -ForegroundColor Green
Write-Host "размер: $size байт"
Write-Host "sha256: $hash"
Write-Host "checksums: $sumFile"
