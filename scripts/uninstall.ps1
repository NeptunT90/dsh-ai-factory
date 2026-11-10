#requires -Version 5.1
<#
.SYNOPSIS
  Remove dsh-ai-factory from a DSH profile. User data is preserved by default.
#>
param(
  [string]$Profile = 'desktop',
  [string]$DshCli = '',
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$dataDir = Join-Path $dshHome 'ai-factory'

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  throw "Профиль '$Profile' не найден: $profileDir"
}
if (-not $DshCli) {
  $DshCli = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $DshCli -or -not (Test-Path $DshCli)) { throw 'Не найден dsh.cmd. Передайте -DshCli <путь>.' }

& $DshCli plugin --profile $Profile remove dsh-ai-factory
if ($LASTEXITCODE -ne 0) { throw "dsh plugin remove завершился с кодом $LASTEXITCODE" }

Write-Host 'Плагин удалён из профиля. Память сохранена:' -ForegroundColor Green
Write-Host "  $dataDir"

if ($PurgeData) {
  $expected = [IO.Path]::GetFullPath((Join-Path $dshHome 'ai-factory'))
  if (-not (Test-Path $dataDir)) { Write-Host 'Каталог данных уже отсутствует.'; exit 0 }
  $actual = [IO.Path]::GetFullPath((Resolve-Path $dataDir).Path)
  if ($actual -ne $expected) { throw "Отказ от удаления: путь не совпадает с ожидаемым. expected=$expected actual=$actual" }
  Write-Host "Удаление данных: $actual" -ForegroundColor Yellow
  Remove-Item -LiteralPath $actual -Recurse -Force
  Write-Host 'Данные AI Factory удалены.'
}
