#requires -Version 5.1
<#
.SYNOPSIS
  Diagnose the AI Factory installation without modifying anything.
#>
param(
  [string]$Profile = 'desktop',
  [string]$DshCli = ''
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $repo 'plugin'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$dataDir = Join-Path $dshHome 'ai-factory'
$dbPath = Join-Path $dataDir 'factory.db'
$issues = New-Object System.Collections.Generic.List[string]

function Write-Check([string]$Name, [bool]$Ok, [string]$Detail) {
  if ($Ok) { Write-Host "[ OK ] $Name — $Detail" -ForegroundColor Green }
  else { Write-Host "[FAIL] $Name — $Detail" -ForegroundColor Red; $script:issues.Add("${Name}: ${Detail}") }
}

Write-Host "DSH AI Factory doctor" -ForegroundColor Cyan
Write-Host "repo: $repo"
Write-Host "profile: $profileDir"
Write-Host ''

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
Write-Check 'Node.js' (($null -ne $node)) $(if ($node) { (& $node.Source -v) } else { 'node.exe не найден в PATH' })

if (-not $DshCli) {
  $DshCli = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
Write-Check 'DSH CLI' (($null -ne $DshCli) -and (Test-Path $DshCli)) $(if ($DshCli) { $DshCli } else { 'не найден' })
if ($DshCli -and (Test-Path $DshCli)) {
  $version = (& $DshCli --version 2>&1 | Out-String).Trim()
  Write-Check 'DSH version' ($version -match '0\.2\.2-rc\.1') $version
}

$manifestPath = Join-Path $profileDir 'package.json'
$manifest = $null
if (Test-Path $manifestPath) {
  try { $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json } catch { $manifest = $null }
}
Write-Check 'Профиль' ($null -ne $manifest) $(if ($manifest) { $manifestPath } else { 'package.json не прочитан' })
if ($manifest) {
  $deps = @($manifest.dependencies.PSObject.Properties.Name)
  $bundles = @($manifest.dsh.profile.bundles)
  Write-Check 'Зависимость dsh-ai-factory' ($deps -contains 'dsh-ai-factory') $(if ($deps -contains 'dsh-ai-factory') { 'есть' } else { 'отсутствует' })
  Write-Check 'Bundle dsh-ai-factory' ($bundles -contains 'dsh-ai-factory') $(if ($bundles -contains 'dsh-ai-factory') { 'есть' } else { 'отсутствует' })
}

$pkgPath = Join-Path $plugin 'package.json'
$pkg = $null
if (Test-Path $pkgPath) { try { $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json } catch {} }
Write-Check 'Пакет плагина' ($null -ne $pkg) $(if ($pkg) { "v$($pkg.version)" } else { 'package.json не прочитан' })
Write-Check 'Собранный entrypoint' (Test-Path (Join-Path $plugin 'lib\index.js')) (Join-Path $plugin 'lib\index.js')
Write-Check 'Bundle patch' (Test-Path (Join-Path $plugin 'cordis.patch.yml')) (Join-Path $plugin 'cordis.patch.yml')

Write-Check 'Каталог данных' (Test-Path $dataDir) $dataDir
Write-Check 'SQLite DB' (Test-Path $dbPath) $dbPath
if ((Test-Path $dbPath) -and $node) {
  $infoScript = Join-Path $PSScriptRoot 'db-info.mjs'
  $info = & $node.Source --no-warnings $infoScript $dbPath 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[info] $info"
  } else {
    Write-Check 'SQLite read' $false ($info | Out-String)
  }
}

Write-Host ''
if ($issues.Count -eq 0) {
  Write-Host 'Итог: проблем не найдено.' -ForegroundColor Green
  exit 0
}
Write-Host "Итог: проблем — $($issues.Count)." -ForegroundColor Red
$issues | ForEach-Object { Write-Host "  - $_" }
exit 1
