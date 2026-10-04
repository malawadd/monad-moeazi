function Read-MonadEnv([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -ErrorAction Stop) {
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $value = $Matches[2]
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2).Replace('\n', "`n").Replace('\"', '"')
    } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$Matches[1]] = $value
  }
  return $values
}

function Import-MonadComposeEnvironment([string]$Root) {
  $path = Join-Path $Root '.env.agents.monad'
  $composePath = Join-Path $Root 'docker-compose.agents.yml'
  $values = Read-MonadEnv $path
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $source = [IO.File]::ReadAllText($composePath)
  foreach ($match in [Regex]::Matches($source, '\$\{([A-Z][A-Z0-9_]*)')) {
    [void]$names.Add($match.Groups[1].Value)
  }
  foreach ($name in $names) {
    $value = if ($values.ContainsKey($name)) { [string]$values[$name] } else { '' }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
  [Environment]::SetEnvironmentVariable('AGENT_ENV_FILE', '.env.agents.monad', 'Process')
  return $values
}

function Invoke-MonadCommand([string]$Executable, [string[]]$Arguments, [switch]$CaptureOutput) {
  $savedPreference = $ErrorActionPreference
  try {
    # Windows PowerShell promotes native stderr (including harmless Docker
    # daemon warnings) to a terminating error when the caller uses Stop.
    $ErrorActionPreference = 'Continue'
    $output = @(& $Executable @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedPreference
  }
  if ($CaptureOutput) { return [pscustomobject]@{ ExitCode = $exitCode; Output = $output } }
  foreach ($line in $output) { Write-Host $line }
  return $exitCode
}
