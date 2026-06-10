Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = "C:\Users\logga\ltth_desktop2\dist\payload-windows-amd64"
$dst = "C:\Users\logga\ltth_desktop2\dist\ltth-payload-windows-amd64-1.3.5.zip"
if (Test-Path $dst) { Remove-Item $dst -Force }
Write-Host "Creating zip from $src ..."
$start = Get-Date
[System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$elapsed = (Get-Date) - $start
Write-Host "Done in $([Math]::Round($elapsed.TotalSeconds, 1))s"
$size = (Get-Item $dst).Length
Write-Host "Size: $([Math]::Round($size / 1MB, 1)) MB"
