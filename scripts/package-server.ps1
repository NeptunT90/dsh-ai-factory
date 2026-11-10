#requires -Version 5.1
<#
.SYNOPSIS
  Build a release tarball for the AI Factory sync server.
.DESCRIPTION
  Compiles server/dist and packages runtime files (dist, scripts, package.json,
  Dockerfile, Compose, env example, README) without node_modules or tests.
  Appends the archive hash to SHA256SUMS.
#>
param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$server = Join-Path $repo 'server'
$packageJson = Join-Path $server 'package.json'
if (-not (Test-Path $packageJson)) { throw "Не найден $packageJson" }
$pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
if (-not $pnpm) { $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue }
if (-not $pnpm) { throw 'pnpm не найден в PATH.' }

Write-Host '[1/4] build server'
Push-Location $repo
try {
  & $pnpm.Source --filter @dsh-ai-factory/sync-server build
  if ($LASTEXITCODE -ne 0) { throw "Сборка сервера завершилась с кодом $LASTEXITCODE" }
} finally { Pop-Location }

$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("dsh-sync-server-" + [guid]::NewGuid().ToString('N'))
$name = "dsh-ai-factory-sync-server-$version"
$stage = Join-Path $stageRoot $name
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
  Copy-Item (Join-Path $server 'dist') (Join-Path $stage 'dist') -Recurse
  Copy-Item (Join-Path $server 'scripts') (Join-Path $stage 'scripts') -Recurse
  foreach ($file in @('package.json', 'README.md', 'Dockerfile', 'docker-compose.yml', '.env.example')) {
    Copy-Item (Join-Path $server $file) (Join-Path $stage $file)
  }
  $license = Join-Path $repo 'LICENSE'
  if (Test-Path $license) { Copy-Item $license (Join-Path $stage 'LICENSE') }

  Write-Host '[2/4] verify staging'
  foreach ($required in @('package.json', 'dist/index.js', 'dist/pg-store.js', 'dist/store.js', 'scripts/restore.mjs', 'Dockerfile')) {
    if (-not (Test-Path (Join-Path $stage $required))) { throw "В архиве отсутствует $required" }
  }

  $tarball = Join-Path $OutDir "$name.tgz"
  Remove-Item $tarball -Force -ErrorAction SilentlyContinue
  Write-Host '[3/4] tar.gz'
  & tar -czf $tarball -C $stageRoot $name
  if ($LASTEXITCODE -ne 0) { throw "tar завершился с кодом $LASTEXITCODE" }
  $listing = & tar -tzf $tarball
  if ($LASTEXITCODE -ne 0 -or -not $listing) { throw 'Архив не читается.' }
  if ($listing -match 'node_modules') { throw 'В архиве найден node_modules.' }

  Write-Host '[4/4] checksums'
  $hash = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant()
  $sumFile = Join-Path $OutDir 'SHA256SUMS'
  $lines = @()
  if (Test-Path $sumFile) {
    $lines = @(Get-Content -LiteralPath $sumFile | Where-Object { $_ -and ($_ -notmatch [regex]::Escape("$name.tgz")) })
  }
  $lines += "$hash  $name.tgz"
  [IO.File]::WriteAllText($sumFile, (($lines -join ([char]10)) + [char]10), (New-Object Text.ASCIIEncoding))

  $size = (Get-Item $tarball).Length
  Write-Host ''
  Write-Host "Готово: $tarball" -ForegroundColor Green
  Write-Host "размер: $size байт"
  Write-Host "sha256: $hash"
} finally {
  Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}
