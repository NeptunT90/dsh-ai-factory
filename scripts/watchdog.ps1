#requires -Version 5.1
<#
.SYNOPSIS
  Crash watchdog for DSH Desktop.

  Launches DSH, waits for it to exit, writes a crash report and restarts it up
  to MaxRestarts times. The plugin reads crash-report.json on its next startup
  and creates a REPAIRER task through DIRECTOR.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/watchdog.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/watchdog.ps1 `
    -DshExe "C:\Path\DeepSeek Harness.exe" -ReportOnly
#>
param(
  [string]$DshExe = '',
  [string]$ReportPath = '',
  [string]$ProjectRoot = '',
  [string]$Profile = 'desktop',
  [int]$MaxRestarts = 3,
  [switch]$ReportOnly
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dataDir = Join-Path $dshHome 'ai-factory'
if (-not $ReportPath) {
  $ReportPath = if ($env:DSH_AI_FACTORY_CRASH_REPORT) { $env:DSH_AI_FACTORY_CRASH_REPORT } else { Join-Path $dataDir 'crash-report.json' }
}
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }
if (-not $DshExe) {
  $DshExe = if ($env:DSH_EXE) {
    $env:DSH_EXE
  } else {
    Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
  }
}

function Get-LogTail {
  $candidates = @(
    $env:DSH_LOG_FILE,
    (Join-Path $dshHome 'logs\dsh.log'),
    (Join-Path $dshHome 'logs\main.log'),
    (Join-Path $env:LOCALAPPDATA 'DeepSeek Harness\logs\dsh.log')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $parts = @()
  foreach ($path in $candidates) {
    try {
      $tail = Get-Content -LiteralPath $path -Tail 80 -ErrorAction Stop
      $parts += ("--- " + $path + " ---")
      $parts += $tail
    } catch {
      $parts += ("log unreadable: " + $path)
    }
  }
  $text = ($parts -join "`n")
  if ($text.Length -gt 20000) { $text = $text.Substring($text.Length - 20000) }
  # Keep credential-like material out of the crash report.
  $text = $text -replace '(?i)(sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}', '[REDACTED]'
  $text = $text -replace '(?i)(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S+', '$1=[REDACTED]'
  return $text
}

function Write-CrashReport {
  param(
    [int]$ExitCode,
    [string]$Reason,
    [int]$RestartCount
  )
  $report = [ordered]@{
    format = 'factory.crash/v1'
    detectedAt = (Get-Date).ToUniversalTime().ToString('o')
    projectRoot = $ProjectRoot
    profile = $Profile
    processName = 'DeepSeek Harness'
    dshExe = $DshExe
    exitCode = $ExitCode
    reason = $Reason
    restartCount = $RestartCount
    logTail = (Get-LogTail)
    handled = $false
  }
  $dir = Split-Path -Parent $ReportPath
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $temp = "$ReportPath.tmp"
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $ReportPath -Force
  Write-Host ("[watchdog] crash report: " + $ReportPath)
}

if ($ReportOnly) {
  Write-CrashReport -ExitCode 0 -Reason 'report-only (watchdog smoke test)' -RestartCount 0
  exit 0
}

if (-not (Test-Path -LiteralPath $DshExe)) {
  Write-CrashReport -ExitCode -1 -Reason ("DSH executable not found: " + $DshExe) -RestartCount 0
  exit 1
}

$restarts = 0
while ($true) {
  Write-Host ("[watchdog] starting DSH: " + $DshExe)
  $process = Start-Process -FilePath $DshExe -PassThru
  Wait-Process -Id $process.Id
  $code = 0
  try { $code = [int]$process.ExitCode } catch { $code = -1 }
  $restarts += 1
  Write-CrashReport -ExitCode $code -Reason 'DSH process exited' -RestartCount $restarts
  if ($restarts -ge [Math]::Max(1, $MaxRestarts)) {
    Write-Host "[watchdog] restart limit reached; stopping"
    break
  }
  Start-Sleep -Seconds 2
}
