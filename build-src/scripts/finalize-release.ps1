Add-Type -AssemblyName System.IO.Compression.FileSystem
$ErrorActionPreference = 'Stop'

$distDir = "C:\Users\logga\ltth_desktop2\dist"
$oldZip = Join-Path $distDir "ltth-payload-windows-amd64-1.3.5-new.zip"
$finalZip = Join-Path $distDir "ltth-payload-windows-amd64-1.3.5.zip"
$bootstrapperSrc = "C:\Users\logga\ltth_desktop2\ltth-bootstrapper.exe"
$bootstrapperDst = Join-Path $distDir "ltth-bootstrapper.exe"

# Rename zip to final name
if (Test-Path $finalZip) { Remove-Item $finalZip -Force -ErrorAction SilentlyContinue }
Rename-Item $oldZip $finalZip -Force

# Copy bootstrapper to dist (if not already there)
if (-not (Test-Path $bootstrapperDst)) {
    Copy-Item $bootstrapperSrc $bootstrapperDst -Force
}

# Generate SHA256 and size
$sha = (Get-FileHash -Path $finalZip -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $finalZip).Length
Write-Host "SHA256: $sha"
Write-Host "Size: $([Math]::Round($size / 1MB, 1)) MB"

# Generate stable.json
$payloadUrl = "https://github.com/Loggableim/ltth_desktop2/releases/download/v1.3.5/ltth-payload-windows-amd64-1.3.5.zip"
$manifest = @{
    version = "1.3.5"
    channel = "stable"
    notes  = "Windows payload for LTTH thin bootstrapper installs."
    payloads = @(
        @{
            platform          = "windows"
            arch              = "amd64"
            payloadUrl        = $payloadUrl
            payloadSha256     = $sha
            payloadSize       = $size
            minBootstrapVersion = "0.1.0"
            archiveFormat     = "zip"
            signed            = $false
        }
    )
} | ConvertTo-Json -Depth 6

Set-Content -Path (Join-Path $distDir "stable.json") -Value $manifest
Write-Host "Created stable.json"

# Final listing
Write-Host "---"
Write-Host "Assets in $distDir :"
Get-ChildItem $distDir | Select-Object Name, @{N="SizeMB";E={[Math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
