param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryRoot,
  [int]$CdpPort = 9231
)

$ErrorActionPreference = "Stop"

$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$injectorScript = Join-Path $RepositoryRoot "scripts\codex-injector.mjs"
if (-not (Test-Path -LiteralPath $injectorScript)) {
  throw "Codex injector was not found: $injectorScript"
}

$arguments = @(
  "`"$injectorScript`"",
  "--launch",
  "--watch",
  "--port",
  [string]$CdpPort
)
Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $RepositoryRoot -WindowStyle Hidden | Out-Null
