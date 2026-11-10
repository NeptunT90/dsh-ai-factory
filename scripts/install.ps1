#requires -Version 5.1
<#
.SYNOPSIS
  Build dsh-ai-factory from this checkout and install it into a DSH profile.
.DESCRIPTION
  Uses the official `dsh plugin ... add` flow, makes a profile config backup
  first, and verifies both the dependency and the bundle selection. User data
  in %USERPROFILE%\.dsh\ai-factory is never deleted.
#>
param(
  [string]$Profile = 'desktop',
  [string]$DshCli = '',
  [string]$Tarball = '',
  [switch]$SkipBuild,
  [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $repo 'plugin'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$profileManifest = Join-Path $profileDir 'package.json'

if (-not (Test-Path $plugin)) { throw "Не найден каталог плагина: $plugin" }
if (-not (Test-Path $profileManifest)) {
  throw "Профиль '$Profile' не найден: $profileManifest. Сначала запустите DSH с этим профилем."
}

if (-not $DshCli) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  )
  $DshCli = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $DshCli -or -not (Test-Path $DshCli)) {
  throw 'Не найден dsh.cmd. Передайте -DshCli <путь к dsh.cmd>.'
}

if (-not $NoBackup) {
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $backup = Join-Path $repo "backups\profile-$Profile-$stamp"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  foreach ($name in @('package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml')) {
    $source = Join-Path $profileDir $name
    if (Test-Path $source) { Copy-Item $source (Join-Path $backup $name) -Force }
  }
  Write-Host "[backup] конфигурация профиля: $backup"
}

$tarballPath = ''
if ($Tarball) {
  if (-not (Test-Path $Tarball)) { throw "Релизный tarball не найден: $Tarball" }
  $tarballPath = (Resolve-Path $Tarball).Path
  if ($tarballPath -notmatch '\.(tgz|tar\.gz)$') { throw 'Ожидается .tgz или .tar.gz релизный tarball.' }
  Write-Host "[install] tarball: $tarballPath"
}

if (-not $tarballPath -and -not $SkipBuild) {
  $pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
  if (-not $pnpm) { $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue }
  if (-not $pnpm) { throw 'pnpm не найден в PATH. Установите pnpm или используйте -SkipBuild после ручной сборки.' }
  Write-Host '[build] pnpm --filter dsh-ai-factory build'
  Push-Location $repo
  try {
    & $pnpm.Source --filter dsh-ai-factory build
    if ($LASTEXITCODE -ne 0) { throw "Сборка завершилась с кодом $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

if (-not $tarballPath -and -not (Test-Path (Join-Path $plugin 'lib\index.js'))) {
  throw 'Нет собранного plugin/lib/index.js. Соберите плагин: pnpm --filter dsh-ai-factory build'
}

$spec = if ($tarballPath) { $tarballPath } else { "link:$($plugin -replace '\\', '/')" }
Write-Host "[install] $spec -> профиль '$Profile'"
& $DshCli plugin --profile $Profile add $spec
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add завершился с кодом $LASTEXITCODE" }

$manifest = Get-Content $profileManifest -Raw | ConvertFrom-Json
$dependencyNames = @($manifest.dependencies.PSObject.Properties.Name)
if ($dependencyNames -notcontains 'dsh-ai-factory') {
  throw 'Проверка не пройдена: dsh-ai-factory отсутствует в dependencies профиля.'
}
$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-ai-factory') {
  throw 'Проверка не пройдена: dsh-ai-factory отсутствует в dsh.profile.bundles. Добавьте bundle вручную или переустановите.'
}

Write-Host ''
Write-Host 'Готово. Плагин установлен в профиль и добавлен в порядок bundles.' -ForegroundColor Green
Write-Host 'Если DSH уже запущен и не применил bundle автоматически — перезапустите приложение.'
Write-Host 'Проверка в чате: "Вызови factory_status и покажи сырые поля".'
