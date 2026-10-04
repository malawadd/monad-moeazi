param(
  [Parameter(Mandatory = $true)][string]$OwnerAddress,
  [Parameter(Mandatory = $true)][string]$VaultAddress,
  [Parameter(Mandatory = $true)][string]$CapitalUnits,
  [switch]$Arm
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$owner = $OwnerAddress.ToLowerInvariant()
$vault = $VaultAddress.ToLowerInvariant()
$validInput = $owner -cmatch '^0x[0-9a-f]{40}$' -and $vault -cmatch '^0x[0-9a-f]{40}$' -and $CapitalUnits -cmatch '^[1-9][0-9]*$'
if (-not $validInput) {
  throw 'Provide the exact Magic owner, deployed vault, and positive USDC units.'
}

Push-Location $taskRoot
try {
  $identity = "{subject:'magic:$owner',authProvider:'magic',walletAddress:'$owner'}"
  $mandateJson = & npx convex run managedSpotMandates:current '{}' --identity $identity
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the current Magic mandate.' }
  $mandate = $mandateJson | ConvertFrom-Json
  $minimumExpiry = ([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds() + 900000
  $fundedMandate = $mandate -and $mandate.status -eq 'active' -and $mandate.ownerAddress -eq $owner -and $mandate.vaultAddress -eq $vault
  $fundedMandate = $fundedMandate -and $mandate.capitalUnits -eq $CapitalUnits -and $mandate.fundingOperation.status -eq 'confirmed' -and $mandate.expiresAt -gt $minimumExpiry
  if (-not $fundedMandate) {
    throw 'The exact Magic mandate is not finalized, funded, and current. No runtime configuration changed.'
  }
  $limitsJson = & npx convex run mobile:getAutopilotLimits '{}' --identity $identity
  if ($LASTEXITCODE -ne 0) { throw 'Could not read managed activation limits.' }
  $limits = $limitsJson | ConvertFrom-Json
  $expectedUsdc = ([decimal]::Parse($CapitalUnits, [Globalization.CultureInfo]::InvariantCulture) / 1000000).ToString([Globalization.CultureInfo]::InvariantCulture)
  $activationReady = $limits.assignmentReady -eq $true -and $limits.managedVaultAddress -eq $vault -and $limits.managedVaultCapitalUsdc -eq $expectedUsdc
  if (-not $activationReady) {
    throw 'Native finance and account activation have not passed for this vault. No runtime configuration changed.'
  }

  $envPath = Join-Path $taskRoot '.env.agents'
  if (-not (Test-Path -LiteralPath $envPath)) { throw 'Local agent configuration is unavailable.' }
  $raw = [System.IO.File]::ReadAllText($envPath)
  $configuredVault = [regex]::Match($raw, '(?m)^MANAGED_VAULT_INTERNAL_TEST_ADDRESS=(.*)$')
  $configuredCap = [regex]::Match($raw, '(?m)^MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS=(.*)$')
  $configuredScope = $configuredVault.Success -and $configuredVault.Groups[1].Value.Trim().ToLowerInvariant() -eq $vault
  $configuredScope = $configuredScope -and $configuredCap.Success -and $configuredCap.Groups[1].Value.Trim() -cmatch '^[1-9][0-9]*$'
  if ($configuredScope) { $configuredScope = [bigint]$configuredCap.Groups[1].Value.Trim() -ge [bigint]$CapitalUnits }
  if (-not $configuredScope) {
    throw 'The local exact-vault address or capital ceiling differs from the funded mandate.'
  }
  Write-Host 'Exact funded mandate, finance activation, and local vault/capital scope passed.'
  if (-not $Arm) { Write-Host 'Dry run only. Pass -Arm to enable this exact-vault execution lane.'; return }

  $updates = @{
    DEPENDENCY_SAFETY_MODE = 'enforce'
    MANAGED_VAULT_EXECUTION_ENABLED = 'true'
    MANAGED_VAULT_STOP_ENABLED = 'true'
  }
  foreach ($key in $updates.Keys) {
    $pattern = "(?m)^$key=.*$"
    if ([regex]::Matches($raw, $pattern).Count -gt 1) {
      throw "Duplicate $key settings; no runtime configuration changed."
    }
  }
  foreach ($key in $updates.Keys) {
    $pattern = "(?m)^$key=.*$"
    if ([regex]::IsMatch($raw, $pattern)) {
      $raw = [regex]::Replace($raw, $pattern, "$key=$($updates[$key])")
    } else {
      $raw = $raw.TrimEnd("`r", "`n") + "`r`n$key=$($updates[$key])`r`n"
    }
  }
  [System.IO.File]::WriteAllText($envPath, $raw)
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'reload-prototype-backend.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Backend reload failed; leave Manual Guard on and inspect service health.' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'reload-mobile-integrations.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Sidecar reload failed; leave Manual Guard on and inspect service health.' }
  Write-Host 'Exact-vault buy and Stop lanes reloaded. Manual Guard remains on until the operator checks Temporal schedules and opens the bounded test window.'
} finally { Pop-Location }
