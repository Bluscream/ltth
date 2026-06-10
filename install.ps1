<#
.SYNOPSIS
    Windows one-line installer for PupCid's Little TikTool Helper (LTTH).

.DESCRIPTION
    Installs LTTH into $env:LOCALAPPDATA\LTTH without admin rights.
    Downloads the latest release payload from GitHub, extracts it,
    creates Start Menu and desktop shortcuts, and prints launch instructions.

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
    [switch]$SkipShortcuts,
    [switch]$Help
)

if ($Help) {
    Get-Help $PSCommandPath
    exit 0
}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'Continue'

# ─── Configuration ────────────────────────────────────────────────────────────
$Repo           = 'Loggableim/ltth_desktop2'
$TempRoot       = "$env:TEMP\ltth-install"
$PayloadDir     = "$InstallDir\current"
$BackupDir      = "$InstallDir\current-backup"
$LauncherCmd    = "$InstallDir\LTTH.cmd"
$ShortcutName   = 'Little TikTool Helper'
$ApiReleasesUrl = "https://api.github.com/repos/$Repo/releases/latest"
$ReleasesUrl    = "https://api.github.com/repos/$Repo/releases"
$DownloadHost   = 'https://github.com'

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

function Get-RelativePath {
    param([string]$Path, [string]$Base)
    $Path = $Path.Replace('\', '/').TrimEnd('/')
    $Base = $Base.Replace('\', '/').TrimEnd('/')
    if ($Path -eq $Base) { return '.' }
    if ($Path.StartsWith($Base + '/')) { return $Path.Substring($Base.Length + 1) }
    return $Path
}

function New-Shortcut {
    param([string]$TargetPath, [string]$ShortcutPath, [string]$Arguments, [string]$IconPath, [string]$Description)
    try {
        $WS = New-Object -ComObject WScript.Shell -ErrorAction Stop
        $sc = $WS.CreateShortcut($ShortcutPath)
        $sc.TargetPath = $TargetPath
        if ($Arguments) { $sc.Arguments = $Arguments }
        if ($IconPath)  { $sc.IconLocation = "$IconPath, 0" }
        if ($Description) { $sc.Description = $Description }
        $sc.Save()
        return $true
    } catch {
        return $false
    }
}

# ─── Prerequisites ─────────────────────────────────────────────────────────────

Write-Host "`n╔══════════════════════════════════════════════╗"
Write-Host "║   LTTH — Windows Installer                  ║"
Write-Host "║   PupCid's Little TikTool Helper             ║"
Write-Host "╚══════════════════════════════════════════════╝`n"

Write-Status 'Checking prerequisites...' Section

# OS check
if ($env:OS -ne 'Windows_NT') {
    Write-Status 'This installer is for Windows only.' Error
    Write-Status 'For other platforms, see the README for manual setup instructions.' Info
    exit 1
}
Write-Status "Operating system: $($env:OS)" OK

# PowerShell version
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Status "PowerShell $($PSVersionTable.PSVersion) is too old." Error
    Write-Status 'Please upgrade to PowerShell 5.1 or later: https://aka.ms/wmf5download' Info
    exit 1
}
Write-Status "PowerShell $($PSVersionTable.PSVersion)" OK

# TLS 1.2
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    Write-Status 'Could not enable TLS 1.2.' Error
    exit 1
}
Write-Status 'TLS 1.2 enabled' OK

# Admin check (not required, just informational)
if (Test-AdminRights) {
    Write-Status 'Running with admin rights (not required — could skip UAC prompts)' Warn
} else {
    Write-Status 'Running without admin rights (normal — no UAC prompt needed)' OK
}

# Execution policy check
$currentPolicy = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction SilentlyContinue
if ($currentPolicy -eq 'Restricted') {
    Write-Status 'Execution policy is Restricted — install.ps1 may not run directly.' Warn
    Write-Status '  The irm | iex pattern bypasses this, but if you saved the script:' Warn
    Write-Status '  Set-ExecutionPolicy RemoteScope CurrentUser -Scope CurrentUser' Info
} else {
    Write-Status "Execution policy: $currentPolicy" OK
}

Write-Host

# ─── Check Internet ──────────────────────────────────────────────────────────

Write-Status 'Checking connectivity...' Section
try {
    $null = Invoke-WebRequest -Uri 'https://api.github.com' -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Status 'GitHub API reachable' OK
} catch {
    Write-Status "Cannot reach GitHub API: $_" Error
    Write-Status 'Please check your internet connection and try again.' Info
    exit 1
}

# ─── Fetch Release Info ───────────────────────────────────────────────────────

Write-Status 'Fetching latest release...' Section
$releaseData = $null
$releaseApiError = $null

try {
    Write-Status "Querying $ApiReleasesUrl ..." Info
    $releaseData = Invoke-RestMethod -Uri $ApiReleasesUrl -UseBasicParsing
} catch {
    $releaseApiError = $_
    Write-Status "Latest endpoint failed: $($_.Exception.Message)" Warn
}

# Fallback: fetch first page and pick first non-draft non-prerelease
if (-not $releaseData -or $releaseData.draft -or (-not $releaseData.assets)) {
    try {
        Write-Status 'Falling back to listing recent releases...' Info
        $releases = Invoke-RestMethod -Uri $ReleasesUrl -UseBasicParsing |
            Where-Object { -not $_.draft -and $_.assets.Count -gt 0 }
        if ($releases) {
            $releaseData = $releases[0]
        }
    } catch {
        Write-Status "Cannot list releases: $_" Error
        exit 1
    }
}

if (-not $releaseData) {
    Write-Status 'No published release found with assets.' Error
    Write-Status 'This repository has not published a Windows installer release yet.' Error
    Write-Status "See: https://github.com/$Repo/releases" Info
    Write-Status '' Info
    Write-Status 'If you are a maintainer, run the release workflow:' Info
    Write-Status "  git tag v<VERSION> && git push origin v<VERSION>" Info
    Write-Status '  The CI pipeline will build and publish bootstrapper + payload.' Info
    exit 1
}

$version = $releaseData.tag_name -replace '^v', ''
Write-Status "Latest release: $($releaseData.tag_name) ($($releaseData.name))" OK

if (-not $releaseData.assets -or $releaseData.assets.Count -eq 0) {
    Write-Status "Release $($releaseData.tag_name) has no downloadable assets." Error
    Write-Status 'A maintainer needs to publish a release with the Windows payload.' Error
    exit 1
}

# ─── Find Compatible Asset ────────────────────────────────────────────────────

Write-Status 'Looking for Windows payload asset...' Section

# Priority 1: Payload zip (ltth-payload-windows-amd64-*.zip)
$payloadAsset = $releaseData.assets | Where-Object {
    $_.name -match '^ltth-payload-windows-amd64-.+\.zip$'
} | Sort-Object -Property size -Descending | Select-Object -First 1

# Priority 2: Bootstrapper exe
$bootstrapperAsset = $releaseData.assets | Where-Object {
    $_.name -eq 'ltth-bootstrapper.exe'
} | Select-Object -First 1

# Priority 3: Generic payload zip (fallback)
if (-not $payloadAsset) {
    $payloadAsset = $releaseData.assets | Where-Object {
        $_.name -match 'ltth.*windows.*\.zip$' -or $_.name -match 'ltth.*payload.*\.zip$'
    } | Sort-Object -Property size -Descending | Select-Object -First 1
}

if (-not $payloadAsset -and -not $bootstrapperAsset) {
    Write-Status 'No compatible Windows asset found in latest release.' Error
    Write-Status "Release $($releaseData.tag_name) contains these assets:" Info
    foreach ($a in $releaseData.assets) {
        Write-Status "  - $($a.name) ($([Math]::Round($a.size / 1MB, 1)) MB)" Info
    }
    Write-Status '' Info
    Write-Status 'Expected one of:' Info
    Write-Status '  - ltth-payload-windows-amd64-<version>.zip  (direct install)' Info
    Write-Status '  - ltth-bootstrapper.exe                      (bootstrapper install)' Info
    Write-Status '' Info
    Write-Status 'To create a compatible release, run the packaging pipeline:' Info
    Write-Status "  cd build-src && go build -o ../ltth-bootstrapper.exe bootstrapper.go" Info
    Write-Status '  Then: npm run package:payload:win -- -Version <ver> -Repository Loggableim/ltth_desktop2' Info
    exit 1
}

if ($payloadAsset) {
    $assetName = $payloadAsset.name
    $assetUrl  = $payloadAsset.browser_download_url
    $assetSize = $payloadAsset.size
    Write-Status "Found payload: $assetName ($([Math]::Round($assetSize / 1MB, 1)) MB)" OK
    $installMode = 'payload'
} else {
    $assetName = $bootstrapperAsset.name
    $assetUrl  = $bootstrapperAsset.browser_download_url
    $assetSize = $bootstrapperAsset.size
    Write-Status "Found bootstrapper: $assetName ($([Math]::Round($assetSize / 1MB, 1)) MB)" OK
    $installMode = 'bootstrapper'
}

# ─── Create Install Directory ─────────────────────────────────────────────────

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

Write-Status "Downloading $assetName ($([Math]::Round($assetSize / 1MB, 1)) MB) ..." Section
$downloadPath = "$TempRoot\$assetName"
try {
    # Use Invoke-WebRequest with progress for reliability across PowerShell versions
    $webReqParams = @{
        Uri             = $assetUrl
        OutFile         = $downloadPath
        UseBasicParsing = $true
        UserAgent       = 'LTTH-Installer/1.0'
        TimeoutSec      = 600
    }
    $downloaded = $false
    $retries = 0
    $maxRetries = 3
    while (-not $downloaded -and $retries -lt $maxRetries) {
        try {
            if ($retries -gt 0) {
                Write-Status "Retry $retries of $maxRetries..." Warn
                Start-Sleep -Seconds 2
            }
            # Show progress manually for large downloads
            Write-Status 'Downloading (this may take a few minutes)...' Info
            Invoke-WebRequest @webReqParams
            $downloaded = $true
        } catch {
            $retries++
            if ($retries -ge $maxRetries) { throw }
            Write-Status "Download attempt $retries failed: $($_.Exception.Message)" Warn
        }
    }
    Write-Status 'Download complete' OK
} catch {
    Write-Status "Download failed after $maxRetries attempts: $_" Error
    exit 1
}

# Verify file exists and has reasonable size
if (-not (Test-Path $downloadPath)) {
    Write-Status 'Downloaded file not found.' Error
    exit 1
}
$downloadedSize = (Get-Item $downloadPath).Length
if ($downloadedSize -lt 1MB) {
    Write-Status "Downloaded file is too small ($([Math]::Round($downloadedSize / 1KB, 1)) KB)." Error
    Write-Status 'The release asset may be incomplete or corrupt.' Error
    exit 1
}

# ─── SHA256 Verification ──────────────────────────────────────────────────────
Write-Status 'Verifying checksum...' Section
try {
    $downloadedHash = (Get-FileHash -Path $downloadPath -Algorithm SHA256).Hash.ToUpper()
    
    # Try to fetch stable.json manifest for checksum verification
    $manifestUrl = $null
    $manifestAsset = $releaseData.assets | Where-Object { $_.name -eq 'stable.json' } | Select-Object -First 1
    if ($manifestAsset) {
        $manifestUrl = $manifestAsset.browser_download_url
    }
    
    if ($manifestUrl) {
        try {
            $stableJson = Invoke-RestMethod -Uri $manifestUrl -UseBasicParsing
            $payloadInfo = $stableJson.payloads | Where-Object {
                $_.platform -eq 'windows' -and $_.arch -eq 'amd64'
            } | Select-Object -First 1
            if ($payloadInfo -and $payloadInfo.payloadSha256) {
                $expectedHash = $payloadInfo.payloadSha256.ToUpper()
                if ($downloadedHash -ne $expectedHash) {
                    Write-Status 'Checksum mismatch!' Error
                    Write-Status "  Expected: $expectedHash" Error
                    Write-Status "  Got:      $downloadedHash" Error
                    Write-Status 'The downloaded file may be corrupted or tampered with.' Error
                    exit 1
                }
                Write-Status 'SHA256 checksum matches manifest' OK
            } else {
                Write-Status 'No checksum in manifest — skipping verification' Warn
            }
        } catch {
            Write-Status "Could not verify checksum (manifest unavailable): $_" Warn
        }
    } else {
        Write-Status "No stable.json in release — skipping checksum verification" Warn
    }
} catch {
    Write-Status "Checksum verification failed: $_" Warn
}

# ─── Backup Existing Installation ─────────────────────────────────────────────
Write-Status 'Backing up existing installation...' Section
if (Test-Path $PayloadDir) {
    # Remove old backup if exists
    if (Test-Path $BackupDir) {
        try {
            Remove-Item -Recurse -Force $BackupDir -ErrorAction Stop
            Write-Status 'Removed old backup' OK
        } catch {
            Write-Status "Could not remove old backup: $_" Error
            exit 1
        }
    }
    # Rename current -> backup
    try {
        Rename-Item -Path $PayloadDir -NewName 'current-backup' -ErrorAction Stop
        Write-Status 'Existing installation backed up' OK
    } catch {
        Write-Status "Could not back up existing installation: $_" Error
        Write-Status 'Is the app currently running? Close it and try again.' Error
        exit 1
    }
} else {
    Write-Status 'No previous installation found' OK
}

# ─── Install ─────────────────────────────────────────────────────────────────

if ($installMode -eq 'payload') {
    Write-Status 'Extracting payload...' Section
    $extractDir = "$TempRoot\extracted"
    try {
        Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue | Out-Null
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        
        Write-Status "Extracting to $extractDir ..." Info
        Expand-Archive -Path $downloadPath -DestinationPath $extractDir -Force
        
        Write-Status 'Extraction complete' OK
    } catch {
        Write-Status "Extraction failed: $_" Error
        # Restore backup
        if (Test-Path $BackupDir) {
            Rename-Item -Path $BackupDir -NewName 'current' -ErrorAction SilentlyContinue
            Write-Status 'Restored previous installation from backup' Warn
        }
        exit 1
    }
    
    # The payload zip may have a single top-level directory or be flat.
    # Determine the payload root.
    $payloadRoot = $extractDir
    $entries = Get-ChildItem -Path $extractDir -Directory
    if ($entries.Count -eq 1) {
        $candidate = $entries[0].FullName
        # Check if this looks like a payload root (has app/package.json)
        if (Test-Path "$candidate\app\package.json") {
            $payloadRoot = $candidate
        }
    }
    
    Write-Status "Payload root: $payloadRoot" Info

    # Move payload to install dir
    try {
        # Create target
        New-Item -ItemType Directory -Force -Path $PayloadDir | Out-Null
        
        # Copy everything from payload root to current/
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
            Write-Status 'Restored previous installation from backup' Warn
        }
        exit 1
    }
    
    # Verify installation
    $verifyFiles = @(
        "$PayloadDir\app\package.json",
        "$PayloadDir\assets\launcher.html",
        "$PayloadDir\locales\de.json",
        "$PayloadDir\runtime\node\node.exe"
    )
    $allOk = $true
    foreach ($f in $verifyFiles) {
        if (-not (Test-Path $f)) {
            Write-Status "Missing expected file: $f" Warn
            $allOk = $false
        }
    }
    if ($allOk) {
        Write-Status 'Installation verified successfully' OK
    } else {
        Write-Status 'Some expected files are missing — installation may be incomplete.' Warn
    }

} else {
    # Bootstrapper mode
    Write-Status 'Launching bootstrapper...' Section
    $bootstrapperPath = "$TempRoot\ltth-bootstrapper.exe"
    try {
        Move-Item -Path $downloadPath -Destination $bootstrapperPath -Force
        Write-Status "Starting bootstrapper from $bootstrapperPath" Info
        Start-Process -FilePath $bootstrapperPath -WorkingDirectory $InstallDir
        Write-Status 'Bootstrapper launched in a separate window.' OK
        Write-Status 'It will handle download, verification, extraction, and shortcuts.' OK
        Write-Status 'The bootstrapper window will close automatically when done.' Info
    } catch {
        Write-Status "Could not launch bootstrapper: $_" Error
        exit 1
    }
}

# ─── Cleanup Old Backup ───────────────────────────────────────────────────────
if (Test-Path $BackupDir) {
    try {
        Remove-Item -Recurse -Force $BackupDir -ErrorAction SilentlyContinue
        Write-Status 'Removed backup of previous version' OK
    } catch {
        Write-Status 'Could not remove backup (harmless)' Warn
    }
}

# ─── Create Shortcuts ─────────────────────────────────────────────────────────
if (-not $SkipShortcuts -and $installMode -eq 'payload') {
    Write-Status 'Creating shortcuts...' Section
    
    $launcherExe = "$PayloadDir\launcher.exe"
    $startMenuDir = [Environment]::GetFolderPath('StartMenu') + '\Programs'
    $desktopDir = [Environment]::GetFolderPath('Desktop')
    
    # Start Menu shortcut
    if ($startMenuDir) {
        $smPath = "$startMenuDir\$ShortcutName.lnk"
        if (New-Shortcut -TargetPath $launcherExe -ShortcutPath $smPath -IconPath "$PayloadDir\icon.ico" -Description 'PupCid\'s Little TikTool Helper') {
            Write-Status "Start Menu shortcut created: $ShortcutName" OK
        } else {
            Write-Status 'Could not create Start Menu shortcut' Warn
        }
    }
    
    # Desktop shortcut
    if ($desktopDir) {
        $dtPath = "$desktopDir\$ShortcutName.lnk"
        if (New-Shortcut -TargetPath $launcherExe -ShortcutPath $dtPath -IconPath "$PayloadDir\icon.ico" -Description 'PupCid\'s Little TikTool Helper') {
            Write-Status "Desktop shortcut created: $ShortcutName" OK
        } else {
            Write-Status 'Could not create desktop shortcut' Warn
        }
    }
}

# ─── Create Launcher CMD ─────────────────────────────────────────────────────
if ($installMode -eq 'payload') {
    Write-Status 'Creating launcher script...' Section
    
    @"
@echo off
REM LTTH Launcher — starts the app using the bundled Node.js runtime
echo Starting LTTH...
set "LTTH_ROOT=%~dp0current"
set "PATH=%LTTH_ROOT%\runtime\node;%PATH%"
cd /d "%LTTH_ROOT%\app"
start "" "%LTTH_ROOT%\launcher.exe"
"@ | Out-File -FilePath $LauncherCmd -Encoding ASCII -Force
    
    Write-Status "Launcher CMD: $LauncherCmd" OK
    
    # Also create a PowerShell launcher
    $LauncherPs1 = "$InstallDir\LTTH.ps1"
    @"
# LTTH Launcher (PowerShell)
`$script:ltthRoot = Join-Path `$PSScriptRoot 'current'
`$env:Path = Join-Path `$script:ltthRoot 'runtime\node' + ';' + `$env:Path
Write-Host 'Starting LTTH...'
Start-Process -FilePath (Join-Path `$script:ltthRoot 'launcher.exe') -WorkingDirectory (Join-Path `$script:ltthRoot 'app')
"@ | Out-File -FilePath $LauncherPs1 -Encoding ASCII -Force
    Write-Status "Launcher PS1: $LauncherPs1" OK
}

# ─── Write Version Info ──────────────────────────────────────────────────────
if ($installMode -eq 'payload') {
    $versionFile = "$InstallDir\installed-version.txt"
    @"
LTTH
Version: $version
Installed: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Source: https://github.com/$Repo
"@ | Out-File -FilePath $versionFile -Encoding ASCII -Force
}

# ─── Cleanup Temp Files ──────────────────────────────────────────────────────
try {
    Remove-Item -Recurse -Force $TempRoot -ErrorAction SilentlyContinue | Out-Null
} catch {
    # Non-critical
}

# ─── Success Message ─────────────────────────────────────────────────────────
Write-Host
Write-Host "╔══════════════════════════════════════════════╗"
Write-Host "║   LTTH v$version  installed successfully!      ║"
if ($installMode -eq 'payload') {
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
    Write-Host "║                                              ║"
    Write-Host "║   User data:                                   ║"
    Write-Host "║   %LOCALAPPDATA%\pupcidslittletiktokhelper"
    Write-Host "║   (preserved across updates)                   ║"
}
Write-Host "╚══════════════════════════════════════════════╝"
Write-Host

if ($installMode -eq 'bootstrapper') {
    Write-Status 'The bootstrapper is installing LTTH in a separate window.' Info
    Write-Status 'Once complete, LTTH will be available from Start Menu or desktop.' Info
}

Write-Status 'To update: re-run the same command.' OK
Write-Status "    irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex" Info
Write-Status 'Existing user data and configuration are preserved automatically.' OK
Write-Host

# ─── Uninstall Info ───────────────────────────────────────────────────────────
Write-Status 'To uninstall, delete the folder and shortcuts:' Info
Write-Status "  Remove-Item -Recurse -Force '$InstallDir'" Info
Write-Status "  Remove-Item '$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$ShortcutName.lnk'" Info
Write-Status "  Remove-Item '$env:USERPROFILE\Desktop\$ShortcutName.lnk'" Info
Write-Status 'User data in %LOCALAPPDATA%\pupcidslittletiktokhelper can be deleted separately.' Info
