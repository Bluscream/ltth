<#
.SYNOPSIS
    Windows one-line installer for PupCid's Little TikTool Helper (LTTH).

.DESCRIPTION
    Installs LTTH into $env:LOCALAPPDATA\LTTH without admin rights.
    Downloads the lightweight ltth-bootstrapper.exe (~9 MB) from the latest
    GitHub release and launches it. The bootstrapper handles the heavy work:
    downloading the full payload (~158 MB) with a browser-based GUI, verifying
    SHA256, extracting, creating shortcuts, and launching the app.

    Usage (run from PowerShell 5.1+):
        irm https://raw.githubusercontent.com/Loggableim/ltth_desktop2/main/install.ps1 | iex

    Re-run to update — existing user config/data in
    %LOCALAPPDATA%\pupcidslittletiktokhelper is preserved automatically.

.NOTES
    Repository: Loggableim/ltth_desktop2
#>

[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\LTTH",
    [switch]$Help
)

if ($Help) {
    Get-Help $PSCommandPath
    exit 0
}

$ErrorActionPreference = 'Stop'

# ─── Configuration ────────────────────────────────────────────────────────────
$Repo           = 'Loggableim/ltth_desktop2'
$TempRoot       = "$env:TEMP\ltth-install"
$ShortcutName   = 'Little TikTool Helper'
$ApiReleasesUrl = "https://api.github.com/repos/$Repo/releases/latest"
$ReleasesUrl    = "https://api.github.com/repos/$Repo/releases"

# ─── Helper Functions ─────────────────────────────────────────────────────────

function Write-Status {
    param([string]$Message, [string]$Kind = 'Info')
    $symbols = @{ Info = 'ℹ'; OK = '✓'; Warn = '⚠'; Error = '✗'; Section = '▸' }
    $s = $symbols[$Kind]
    if (-not $s) { $s = '•' }
    Write-Host "  $s $Message" -ForegroundColor @{
        Info    = 'Cyan'
        OK      = 'Green'
        Warn    = 'Yellow'
        Error   = 'Red'
        Section = 'Magenta'
    }[$Kind]
}

function Test-AdminRights {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ─── Prerequisites ─────────────────────────────────────────────────────────────

Write-Host "`n╔══════════════════════════════════════════════╗"
Write-Host "║   LTTH — Windows Installer                  ║"
Write-Host "║   PupCid's Little TikTool Helper             ║"
Write-Host "╚══════════════════════════════════════════════╝`n"

Write-Status 'Checking prerequisites...' Section

if ($env:OS -ne 'Windows_NT') {
    Write-Status 'This installer is for Windows only.' Error
    exit 1
}
Write-Status "Operating system: Windows_NT" OK

if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Status "PowerShell $($PSVersionTable.PSVersion) is too old. Upgrade to PS 5.1+." Error
    exit 1
}
Write-Status "PowerShell $($PSVersionTable.PSVersion)" OK

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    Write-Status 'Could not enable TLS 1.2.' Error
    exit 1
}
Write-Status 'TLS 1.2 enabled' OK

if (Test-AdminRights) {
    Write-Status 'Running with admin rights (not required)' Warn
} else {
    Write-Status 'Running without admin rights (normal)' OK
}

# ─── Connectivity ─────────────────────────────────────────────────────────────

Write-Status 'Checking connectivity...' Section
try {
    $null = Invoke-WebRequest -Uri 'https://api.github.com' -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Status 'GitHub API reachable' OK
} catch {
    Write-Status "Cannot reach GitHub API: $_" Error
    exit 1
}

# ─── Fetch Release ────────────────────────────────────────────────────────────

Write-Status 'Fetching latest release...' Section
$releaseData = $null

try {
    $releaseData = Invoke-RestMethod -Uri $ApiReleasesUrl -UseBasicParsing
} catch {
    Write-Status "Latest endpoint failed: $($_.Exception.Message)" Warn
}

# Fallback: first non-draft release with assets
if (-not $releaseData -or $releaseData.draft -or (-not $releaseData.assets)) {
    try {
        Write-Status 'Falling back to listing recent releases...' Info
        $releases = Invoke-RestMethod -Uri $ReleasesUrl -UseBasicParsing |
            Where-Object { -not $_.draft -and $_.assets.Count -gt 0 }
        if ($releases) { $releaseData = $releases[0] }
    } catch {
        Write-Status "Cannot list releases: $_" Error
        exit 1
    }
}

if (-not $releaseData) {
    Write-Status 'No published release found with assets.' Error
    Write-Status "See: https://github.com/$Repo/releases" Info
    exit 1
}

$version = $releaseData.tag_name -replace '^v', ''
Write-Status "Latest release: $($releaseData.tag_name)" OK

if (-not $releaseData.assets -or $releaseData.assets.Count -eq 0) {
    Write-Status "Release $($releaseData.tag_name) has no downloadable assets." Error
    exit 1
}

# ─── Find Asset ───────────────────────────────────────────────────────────────

# Priority 1: ltth-bootstrapper.exe (lightweight, ~9 MB)
$bootstrapperAsset = $releaseData.assets | Where-Object { $_.name -eq 'ltth-bootstrapper.exe' } | Select-Object -First 1

# Priority 2: ltth-payload-windows-amd64-*.zip (fallback, ~158 MB)
$payloadAsset = $null
if (-not $bootstrapperAsset) {
    $payloadAsset = $releaseData.assets | Where-Object {
        $_.name -match '^ltth-payload-windows-amd64-.+\.zip$'
    } | Sort-Object -Property size -Descending | Select-Object -First 1
}

if (-not $bootstrapperAsset -and -not $payloadAsset) {
    Write-Status 'No compatible Windows asset found.' Error
    Write-Status "Release $($releaseData.tag_name) contains:" Info
    foreach ($a in $releaseData.assets) {
        Write-Status "  - $($a.name) ($([Math]::Round($a.size / 1MB, 1)) MB)" Info
    }
    Write-Status '' Info
    Write-Status 'Expected: ltth-bootstrapper.exe (preferred) or ltth-payload-windows-amd64-<ver>.zip' Info
    exit 1
}

if ($bootstrapperAsset) {
    $assetName  = $bootstrapperAsset.name
    $assetUrl   = $bootstrapperAsset.browser_download_url
    $assetSize  = $bootstrapperAsset.size
    $installMode = 'bootstrapper'
    Write-Status "Found bootstrapper: $assetName ($([Math]::Round($assetSize / 1MB, 1)) MB)" OK
} else {
    $assetName  = $payloadAsset.name
    $assetUrl   = $payloadAsset.browser_download_url
    $assetSize  = $payloadAsset.size
    $installMode = 'payload'
    Write-Status "No bootstrapper found — using payload fallback: $assetName ($([Math]::Round($assetSize / 1MB, 1)) MB)" Warn
}

# ─── Create Install Dir ───────────────────────────────────────────────────────

Write-Status 'Preparing install directory...' Section
try {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
    Write-Status "Install root: $InstallDir" OK
} catch {
    Write-Status "Cannot create install directory: $_" Error
    exit 1
}

# ─── Download ─────────────────────────────────────────────────────────────────

Write-Status "Downloading $assetName ..." Section
$downloadPath = "$TempRoot\$assetName"
try {
    # Prefer curl.exe (built into Win10/11, HTTP/2, much faster than Invoke-WebRequest)
    $curlPath = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
    if ($curlPath -and $curlPath.Path -like '*\curl.exe') {
        Write-Status 'Using curl (HTTP/2 download)...' Info
        $retries = 0
        $maxRetries = 3
        while ($retries -lt $maxRetries) {
            try {
                if ($retries -gt 0) {
                    Write-Status "Retry $retries of $maxRetries..." Warn
                    Start-Sleep -Seconds 2
                }
                # curl --progress-bar shows a nice progress meter (stderr, so PS output stays clean)
                & $curlPath.Path --fail --location --progress-bar -o "$downloadPath" "$assetUrl"
                if ($LASTEXITCODE -ne 0) { throw "curl exited with code $LASTEXITCODE" }
                break
            } catch {
                $retries++
                if ($retries -ge $maxRetries) { throw }
                Write-Status "Attempt $retries failed: $($_.Exception.Message)" Warn
            }
        }
    } else {
        Write-Status 'Using Invoke-WebRequest...' Info
        $retries = 0
        $maxRetries = 3
        while ($retries -lt $maxRetries) {
            try {
                if ($retries -gt 0) {
                    Write-Status "Retry $retries of $maxRetries..." Warn
                    Start-Sleep -Seconds 2
                }
                Invoke-WebRequest -Uri $assetUrl -OutFile $downloadPath -UseBasicParsing -UserAgent 'LTTH-Installer/1.0' -TimeoutSec 600
                break
            } catch {
                $retries++
                if ($retries -ge $maxRetries) { throw }
                Write-Status "Attempt $retries failed: $($_.Exception.Message)" Warn
            }
        }
    }
    Write-Status 'Download complete' OK
} catch {
    Write-Status "Download failed: $_" Error
    exit 1
}

$downloadedSize = (Get-Item $downloadPath).Length
if ($downloadedSize -lt 1MB) {
    Write-Status "Downloaded file too small ($([Math]::Round($downloadedSize / 1KB, 1)) KB)." Error
    exit 1
}

# ─── Bootstrapper Install ─────────────────────────────────────────────────────

if ($installMode -eq 'bootstrapper') {
    Write-Status 'Setting up LTTH bootstrapper...' Section

    $bootstrapperDst = "$InstallDir\ltth-bootstrapper.exe"

    # Kill any running LTTH bootstrapper or launcher processes
    foreach ($proc in @('ltth-bootstrapper', 'launcher')) {
        try {
            $p = Get-Process -Name $proc -ErrorAction SilentlyContinue
            if ($p) {
                Write-Status "Stopping existing $proc process(es)..." Warn
                $p | Stop-Process -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
            }
        } catch { }
    }

    # Copy bootstrapper to install dir
    try {
        Copy-Item -Path $downloadPath -Destination $bootstrapperDst -Force
        Write-Status "Bootstrapper placed at $bootstrapperDst" OK
    } catch {
        Write-Status "Could not copy bootstrapper: $_" Error
        exit 1
    }

    # Determine manifest base URL (points to the release's stable.json)
    $manifestBaseUrl = "https://github.com/$Repo/releases/download/v$version"

    Write-Status 'Launching bootstrapper...' Info
    Write-Status '  The bootstrapper will open a browser window and guide you through installation.' Info
    Write-Status "  Manifest: $manifestBaseUrl/stable.json" Info
    Write-Host

    try {
        # Set env var so the bootstrapper finds the right manifest
        $env:LTTH_BOOTSTRAP_MANIFEST_BASE_URL = $manifestBaseUrl
        Start-Process -FilePath $bootstrapperDst -WorkingDirectory $InstallDir -NoNewWindow:$false
        Write-Status 'Bootstrapper launched. It will download the full LTTH payload (~158 MB),' OK
        Write-Status 'verify it, extract it, create shortcuts, and launch the app.' OK
    } catch {
        Write-Status "Could not launch bootstrapper: $_" Error
        exit 1
    }

    # Cleanup temp
    Remove-Item -Recurse -Force $TempRoot -ErrorAction SilentlyContinue | Out-Null

    Write-Host
    Write-Host "╔══════════════════════════════════════════════╗"
    Write-Host "║   LTTH Bootstrapper v$version  launched!       ║"
    Write-Host "║                                              ║"
    Write-Host "║   The bootstrapper window will guide you      ║"
    Write-Host "║   through the rest of the installation.       ║"
    Write-Host "║                                              ║"
    Write-Host "║   After installation:                          ║"
    Write-Host "║   • Start Menu → $ShortcutName"
    Write-Host "║   • Desktop shortcut                           ║"
    Write-Host "║   • Dashboard: http://localhost:3000/dashboard ║"
    Write-Host "╚══════════════════════════════════════════════╝"
    Write-Host
    Write-Status 'To update: re-run' OK
    Write-Status "  irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex" Info
    exit 0
}

# ─── Payload (Direct) Install — Fallback ──────────────────────────────────────
# Only runs if no bootstrapper asset exists in the release

Write-Status 'No bootstrapper in release — installing payload directly...' Warn

$PayloadDir = "$InstallDir\current"
$BackupDir  = "$InstallDir\current-backup"

# SHA256 verification if manifest exists
Write-Status 'Verifying checksum...' Section
$manifestAsset = $releaseData.assets | Where-Object { $_.name -eq 'stable.json' } | Select-Object -First 1
if ($manifestAsset) {
    try {
        $stableJson = Invoke-RestMethod -Uri $manifestAsset.browser_download_url -UseBasicParsing
        $payloadInfo = $stableJson.payloads | Where-Object { $_.platform -eq 'windows' -and $_.arch -eq 'amd64' } | Select-Object -First 1
        if ($payloadInfo -and $payloadInfo.payloadSha256) {
            $expectedHash = $payloadInfo.payloadSha256.ToUpper()
            $gotHash = (Get-FileHash -Path $downloadPath -Algorithm SHA256).Hash.ToUpper()
            if ($gotHash -ne $expectedHash) {
                Write-Status "SHA256 mismatch! Expected $expectedHash`n  Got: $gotHash" Error
                exit 1
            }
            Write-Status 'SHA256 checksum verified' OK
        }
    } catch { Write-Status "Checksum verification unavailable: $_" Warn }
} else {
    Write-Status 'No stable.json in release — skipping checksum' Warn
}

# Backup old — preserve user configs/data from old install
Write-Status 'Backing up existing installation...' Section
$preserveDirs = @()
if (Test-Path $PayloadDir) {
    # Save any user configs/data from old install before replacing
    foreach ($relPath in @('app\user_configs', 'app\user_data', 'app\uploads')) {
        $src = "$PayloadDir\$relPath"
        if (Test-Path $src) {
            $preserveDirs += @{ Source = $src; Relative = $relPath }
            Write-Status "Found existing data: $relPath (will preserve)" OK
        }
    }
    Remove-Item -Recurse -Force $BackupDir -ErrorAction SilentlyContinue
    try {
        Rename-Item -Path $PayloadDir -NewName 'current-backup' -ErrorAction Stop
        Write-Status 'Existing installation backed up' OK
    } catch {
        Write-Status "Could not back up (app running?). Error: $_" Error
        exit 1
    }
} else {
    Write-Status 'No previous installation found' OK
}

# Extract
Write-Status 'Extracting payload...' Section
$extractDir = "$TempRoot\extracted"
try {
    Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue | Out-Null
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $downloadPath -DestinationPath $extractDir -Force
    Write-Status 'Extraction complete' OK
} catch {
    Write-Status "Extraction failed: $_" Error
    if (Test-Path $BackupDir) { Rename-Item -Path $BackupDir -NewName 'current' -ErrorAction SilentlyContinue }
    exit 1
}

# Find payload root (might have single wrapper dir)
$payloadRoot = $extractDir
$dirs = Get-ChildItem -Path $extractDir -Directory
if ($dirs.Count -eq 1 -and (Test-Path "$($dirs[0].FullName)\app\package.json")) {
    $payloadRoot = $dirs[0].FullName
}

# Copy to install dir
Write-Status "Installing to $PayloadDir ..." Info
try {
    New-Item -ItemType Directory -Force -Path $PayloadDir | Out-Null
    $items = Get-ChildItem -Path $payloadRoot
    foreach ($item in $items) {
        $target = "$PayloadDir\$($item.Name)"
        if ($item.PSIsContainer) {
            Copy-Item -Recurse -Path $item.FullName -Destination $target -Force -ErrorAction Stop
        } else {
            Copy-Item -Path $item.FullName -Destination $target -Force -ErrorAction Stop
        }
    }
    Write-Status 'Payload installed' OK
} catch {
    Write-Status "Install failed: $_" Error
    if (Test-Path $BackupDir) {
        Remove-Item -Recurse -Force $PayloadDir -ErrorAction SilentlyContinue
        Rename-Item -Path $BackupDir -NewName 'current' -ErrorAction SilentlyContinue
    }
    exit 1
}

# Restore preserved user configs/data from old install
if ($preserveDirs.Count -gt 0) {
    Write-Status 'Restoring user configs/data from previous installation...' Section
    foreach ($entry in $preserveDirs) {
        $target = "$PayloadDir\$($entry.Relative)"
        try {
            $parent = Split-Path $target -Parent
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            Copy-Item -Recurse -Path $entry.Source -Destination $target -Force -ErrorAction Stop
            Write-Status "Restored: $($entry.Relative)" OK
        } catch {
            Write-Status "Could not restore $($entry.Relative): $_" Warn
        }
    }
}

# Remove backup
Remove-Item -Recurse -Force $BackupDir -ErrorAction SilentlyContinue

# Verify
$ok = $true
foreach ($f in @("$PayloadDir\app\package.json", "$PayloadDir\runtime\node\node.exe", "$PayloadDir\launcher.exe")) {
    if (-not (Test-Path $f)) { Write-Status "Missing: $f" Warn; $ok = $false }
}
if ($ok) { Write-Status 'Installation verified' OK }

# Shortcuts
Write-Status 'Creating shortcuts...' Section
$launcherExe = "$PayloadDir\launcher.exe"
$iconPath    = "$PayloadDir\icon.ico"
$smDir = [Environment]::GetFolderPath('StartMenu')
$dtDir = [Environment]::GetFolderPath('Desktop')

if ($smDir) {
    $smDir = "$smDir\Programs"
    try {
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut("$smDir\$ShortcutName.lnk")
        $sc.TargetPath = $launcherExe
        if (Test-Path $iconPath) { $sc.IconLocation = "$iconPath, 0" }
        $sc.Description = "PupCid's Little TikTool Helper"
        $sc.Save()
        Write-Status "Start Menu shortcut: $ShortcutName" OK
    } catch { Write-Status 'Could not create Start Menu shortcut' Warn }
}
if ($dtDir) {
    try {
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut("$dtDir\$ShortcutName.lnk")
        $sc.TargetPath = $launcherExe
        if (Test-Path $iconPath) { $sc.IconLocation = "$iconPath, 0" }
        $sc.Description = "PupCid's Little TikTool Helper"
        $sc.Save()
        Write-Status "Desktop shortcut created" OK
    } catch { Write-Status 'Could not create desktop shortcut' Warn }
}

# Launcher CMD
$LauncherCmd = "$InstallDir\LTTH.cmd"
@"
@echo off
echo Starting LTTH...
set "LTTH_ROOT=%~dp0current"
set "PATH=%LTTH_ROOT%\runtime\node;%PATH%"
cd /d "%LTTH_ROOT%\app"
start "" "%LTTH_ROOT%\launcher.exe"
"@ | Out-File -FilePath $LauncherCmd -Encoding ASCII -Force
Write-Status "Launcher script: $LauncherCmd" OK

# Version file
"LTTH v$version`nInstalled: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`nSource: https://github.com/$Repo" |
    Out-File -FilePath "$InstallDir\installed-version.txt" -Encoding ASCII -Force

# Cleanup
Remove-Item -Recurse -Force $TempRoot -ErrorAction SilentlyContinue | Out-Null

# Success
Write-Host
Write-Host "╔══════════════════════════════════════════════╗"
Write-Host "║   LTTH v$version  installed successfully!      ║"
Write-Host "║                                              ║"
Write-Host "║   Install path:                               ║"
Write-Host "║   $InstallDir"
Write-Host "║                                              ║"
Write-Host "║   Launch:                                      ║"
Write-Host "║   • Start Menu → $ShortcutName"
Write-Host "║   • Desktop shortcut                           ║"
Write-Host "║   • $LauncherCmd"
Write-Host "║                                              ║"
Write-Host "║   Dashboard: http://localhost:3000/dashboard   ║"
Write-Host "╚══════════════════════════════════════════════╝"
Write-Host
Write-Status 'To update: re-run' OK
Write-Status "  irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex" Info
Write-Status 'User data in %LOCALAPPDATA%\pupcidslittletiktokhelper preserved.' OK
Write-Host
Write-Status 'To uninstall:' Info
Write-Status "  Remove-Item -Recurse -Force '$InstallDir'" Info
Write-Status "  Remove-Item '$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$ShortcutName.lnk" Info
Write-Status "  Remove-Item '$env:USERPROFILE\Desktop\$ShortcutName.lnk" Info
