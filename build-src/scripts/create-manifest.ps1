$distDir = "C:\Users\logga\ltth_desktop2\dist"
$zipPath = Join-Path $distDir "ltth-payload-windows-amd64-1.3.5.zip"
$sha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item $zipPath).Length
Write-Host "SHA256: $sha"
Write-Host "Size: $([Math]::Round($size / 1MB, 1)) MB"

$manifest = @{
    version = "1.3.5"
    channel = "stable"
    notes   = "Windows payload for LTTH thin bootstrapper installs."
    payloads = @(
        @{
            platform          = "windows"
            arch              = "amd64"
            payloadUrl        = "https://github.com/Loggableim/ltth_desktop2/releases/download/v1.3.5/ltth-payload-windows-amd64-1.3.5.zip"
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
Get-ChildItem $distDir | Select-Object Name, Length | Format-Table -AutoSize
