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

$taskbarDirectory = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
New-Item -ItemType Directory -Path $taskbarDirectory -Force | Out-Null
$shortcutPath = Join-Path $taskbarDirectory "Codex.lnk"
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

Write-Output "Created taskbar shortcut: $shortcutPath"
Write-Output "Target: $codexExecutable"
Write-Output "Arguments: $($shortcut.Arguments)"
