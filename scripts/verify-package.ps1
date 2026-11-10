#requires -Version 5.1
<#
.SYNOPSIS
  Verify that a dsh-ai-factory release tarball is installable and complete.
#>
param(
  [Parameter(Mandatory = $true)][string]$Tarball
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Tarball)) { throw "Tarball не найден: $Tarball" }
$entries = @(& tar -tzf $Tarball)
if ($LASTEXITCODE -ne 0) { throw 'tar не смог прочитать архив.' }

$required = @(
  'package/package.json',
  'package/lib/index.js',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/LICENSE'
)
foreach ($entry in $required) {
  if ($entries -notcontains $entry) { throw "В tarball нет обязательного файла: $entry" }
}
if ($entries | Where-Object { $_ -like 'package/node_modules/*' }) {
  throw 'Tarball содержит node_modules; это недопустимо для релиза.'
}

$jsonText = & tar -xOzf $Tarball package/package.json
if ($LASTEXITCODE -ne 0) { throw 'Не удалось прочитать package/package.json из tarball.' }
$pkg = $jsonText | ConvertFrom-Json
if ($pkg.name -ne 'dsh-ai-factory') { throw "Неверное имя пакета: $($pkg.name)" }
if (-not $pkg.version) { throw 'В package.json нет version.' }
if (-not $pkg.dsh.bundle.patch) { throw 'В package.json нет dsh.bundle.patch.' }
if (-not $pkg.engines.dsh) { throw 'В package.json нет engines.dsh.' }

Write-Host "[verify] $($pkg.name)@$($pkg.version): обязательные файлы на месте, node_modules отсутствует." -ForegroundColor Green
