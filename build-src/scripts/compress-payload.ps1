param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$Version = '1.3.5'
)

$ErrorActionPreference = 'Stop'
$distDir = Join-Path $ProjectRoot 'dist'
$payloadRoot = Join-Path $distDir 'payload-windows-amd64'
$payloadName = "ltth-payload-windows-amd64-$Version.zip"
$payloadPath = Join-Path $distDir $payloadName

Write-Host "Compressing $payloadRoot to $payloadPath ..."
$start = Get-Date

# Remove old zip if exists
if (Test-Path $payloadPath) { Remove-Item $payloadPath -Force }

Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $payloadPath -CompressionLevel Optimal

$elapsed = (Get-Date) - $start
Write-Host "Done in $([Math]::Round($elapsed.TotalSeconds, 1))s"

# Generate SHA256
$sha = (Get-FileHash -Path $payloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $payloadPath).Length
Write-Host "Size: $([Math]::Round($size / 1MB, 1)) MB"
Write-Host "SHA256: $sha"

# Generate stable.json
$payloadUrl = "https://github.com/Loggableim/ltth_desktop2/releases/download/v$Version/$payloadName"
$manifest = @{
    version = $Version
    channel = 'stable'
    notes  = 'Windows payload for LTTH thin bootstrapper installs.'
    payloads = @(
        @{
            platform          = 'windows'
            arch              = 'amd64'
            payloadUrl        = $payloadUrl
            payloadSha256     = $sha
            payloadSize       = $size
            minBootstrapVersion = '0.1.0'
            archiveFormat     = 'zip'
            signed            = $false
        }
    )
} | ConvertTo-Json -Depth 6

Set-Content -Path (Join-Path $distDir 'stable.json') -Value $manifest
Write-Host "Created stable.json"

Write-Host "---"
Write-Host "Assets ready in $distDir :"
Get-ChildItem $distDir | Select-Object Name, Length | Format-Table -AutoSize
