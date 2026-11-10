#requires -Version 5.1
<#
.SYNOPSIS
  Update dsh-ai-factory in a profile with a data/profile backup first.
#>
param(
  [string]$Profile = 'desktop',
  [string]$Tarball = '',
  [string]$DshCli = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

Write-Host '[update] backup data and profile configuration'
& (Join-Path $PSScriptRoot 'backup.ps1') -Profile $Profile
if ($LASTEXITCODE -ne 0) { throw 'Backup завершился с ошибкой; обновление остановлено.' }

$args = @('-Profile', $Profile, '-NoBackup')
if ($DshCli) { $args += @('-DshCli', $DshCli) }
if ($Tarball) { $args += @('-Tarball', $Tarball) }
& (Join-Path $PSScriptRoot 'install.ps1') @args
if ($LASTEXITCODE -ne 0) { throw 'Установка обновления завершилась с ошибкой.' }

Write-Host 'Обновление завершено. Проверьте factory_status и при необходимости перезапустите DSH.' -ForegroundColor Green
