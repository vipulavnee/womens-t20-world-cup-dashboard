$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repo

$delaySeconds = 90
$lastSignature = ""
$pendingSince = $null
$lastChangeAt = $null

$trackedPaths = @(
  "package.json",
  "render.yaml",
  "server-cricket.js",
  "server-other-sports.js",
  "public\cricket-dashboard.html",
  "public\other-sports-dashboard.html",
  "Start Cricket Dashboard.bat",
  "Start Other Sports Dashboard.bat",
  "Publish Cricket Dashboard to Render.bat",
  "Publish to GitHub for Manual Render Deploy.bat",
  "Auto Publish to Render Watcher.bat",
  "auto-publish-render-watcher.ps1"
)

function Write-Stamp($message) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message)
}

function Get-RepoSignature {
  $status = git status --porcelain -- $trackedPaths 2>$null
  if ($LASTEXITCODE -ne 0) { return "" }
  return ($status -join "`n")
}

function Publish-Changes {
  git config user.name "Vipul" | Out-Null
  git config user.email "vipulavnee@users.noreply.github.com" | Out-Null

  git add -- $trackedPaths
  if ($LASTEXITCODE -ne 0) { throw "Could not stage dashboard files." }

  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Stamp "No publishable dashboard changes."
    return
  }

  $message = "Auto publish dashboards {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")
  git commit -m $message
  if ($LASTEXITCODE -ne 0) { throw "Could not commit dashboard changes." }

  git push origin main
  if ($LASTEXITCODE -ne 0) { throw "Could not push to GitHub." }

  Write-Stamp "Uploaded to GitHub. Render auto-deploy should start."
}

Write-Stamp "Watching cricket dashboard folder for publishable changes."
Write-Stamp "Delay after last change: $delaySeconds seconds."
Write-Stamp "Close this window to stop."

while ($true) {
  try {
    $signature = Get-RepoSignature

    if ($signature -and $signature -ne $lastSignature) {
      $lastSignature = $signature
      $lastChangeAt = Get-Date
      if (-not $pendingSince) { $pendingSince = $lastChangeAt }
      Write-Stamp "Change detected. Waiting for saves to settle..."
    }

    if ($pendingSince -and $lastChangeAt) {
      $quietFor = ((Get-Date) - $lastChangeAt).TotalSeconds
      if ($quietFor -ge $delaySeconds) {
        Write-Stamp "Publishing settled changes..."
        Publish-Changes
        $pendingSince = $null
        $lastChangeAt = $null
        $lastSignature = Get-RepoSignature
      }
    }
  } catch {
    Write-Stamp ("Publish failed: {0}" -f $_.Exception.Message)
    Write-Stamp "Will retry after the next detected change."
    $pendingSince = $null
    $lastChangeAt = $null
    $lastSignature = Get-RepoSignature
  }

  Start-Sleep -Seconds 5
}
