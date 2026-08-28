param(
  [string]$RepositoryRoot = $(Split-Path -Parent $PSScriptRoot),
  [int]$CdpPort = 9231
)

$ErrorActionPreference = "Stop"

$package = Get-AppxPackage -Name "OpenAI.Codex" | Select-Object -First 1
if (-not $package) {
  throw "Codex Desktop is not installed."
}

$codexExecutable = Join-Path -Path $package.InstallLocation -ChildPath "app\ChatGPT.exe"
if (-not (Test-Path -LiteralPath $codexExecutable)) {
  throw "Codex executable was not found: $codexExecutable"
}

$desktopDirectory = [Environment]::GetFolderPath("Desktop")
$taskbarDirectory = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
New-Item -ItemType Directory -Path $desktopDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $taskbarDirectory -Force | Out-Null
$shortcutPath = Join-Path $desktopDirectory "Codex.lnk"
if (Test-Path -LiteralPath $shortcutPath) {
  Copy-Item -LiteralPath $shortcutPath -Destination "$shortcutPath.backup" -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $codexExecutable
$shortcut.Arguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$CdpPort --remote-allow-origins=http://127.0.0.1:$CdpPort"
$shortcut.WorkingDirectory = Split-Path -Parent $codexExecutable
$shortcut.IconLocation = "$codexExecutable,0"
$shortcut.Description = "Codex Desktop (main profile + Taskboard CDP)"
$shortcut.Save()

$appsFolder = (New-Object -ComObject Shell.Application).Namespace("shell:AppsFolder")
$codexApp = $appsFolder.Items() | Where-Object { $_.Path -eq "OpenAI.Codex_2p2nqsd0c76g0!App" } | Select-Object -First 1
$unpinVerb = @($codexApp.Verbs() | Where-Object { $_.Name -match "工作列取消釘選|Unpin from taskbar" }) | Select-Object -First 1
if ($unpinVerb) {
  $unpinVerb.DoIt()
  Start-Sleep -Milliseconds 500
}

$sourceItem = (New-Object -ComObject Shell.Application).Namespace($desktopDirectory).ParseName("Codex.lnk")
$pinVerb = @($sourceItem.Verbs() | Where-Object { $_.Name -match "釘選到工作列|Pin to taskbar" }) | Select-Object -First 1
$pinned = $false
if ($pinVerb) {
  $pinVerb.DoIt()
  $pinned = $true
  Start-Sleep -Milliseconds 500
} else {
  Write-Output "Windows did not expose the taskbar pin action; pin Codex.lnk from the desktop or File Explorer."
}

$legacyTaskbarShortcut = Join-Path $taskbarDirectory "Codex.lnk"
if (Test-Path -LiteralPath $legacyTaskbarShortcut) {
  Copy-Item -LiteralPath $legacyTaskbarShortcut -Destination "$legacyTaskbarShortcut.backup" -Force
  Remove-Item -LiteralPath $legacyTaskbarShortcut -Force
}

if ($pinned) {
  Write-Output "Created and pinned taskbar shortcut from: $shortcutPath"
} else {
  Write-Output "Created CDP shortcut on the desktop: $shortcutPath"
}
Write-Output "Target: $codexExecutable"
Write-Output "Arguments: $($shortcut.Arguments)"
