#Requires -Version 5.1
<#
.SYNOPSIS
    PupCid's Little TikTool Helper — Simple Launcher (PowerShell)

.DESCRIPTION
    Portable launcher for LTTH on Windows 10/11.
    Checks system requirements, installs dependencies when needed,
    selects a free port with automatic fallback, starts the Node.js
    server and opens the browser after a short delay.

.PARAMETER NoPause
    Skip the "Press Enter to close" prompt at the end.

.PARAMETER DebugMode
    Enable verbose DEBUG-level log output.

.PARAMETER PreferredPort
    Override the default preferred port (default: 3000).
#>
param(
    [switch]$NoPause,
    [switch]$DebugMode,
    [int]$PreferredPort = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# ─── Script-level state ──────────────────────────────────────────────────────
$script:DebugMode    = $DebugMode.IsPresent
$script:ResolvedPort = $PreferredPort
$script:LogFile      = $null
$browserJob          = $null
$readinessJob        = $null

# ─── Logging ─────────────────────────────────────────────────────────────────
function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('INFO','OK','WARN','ERROR','DEBUG','STEP','BANNER')]
        [string]$Level = 'INFO',
        [switch]$NoNewline
    )

    # Skip DEBUG unless DebugMode is on
    if ($Level -eq 'DEBUG' -and -not $script:DebugMode) { return }

    $now       = Get-Date
    $timeStamp = $now.ToString('HH:mm:ss')
    $dateTime  = $now.ToString('yyyy-MM-dd HH:mm:ss')

    switch ($Level) {
        'INFO'   { $color = 'Cyan';     $prefix = '[INFO] ' }
        'OK'     { $color = 'Green';    $prefix = '[OK]   ' }
        'WARN'   { $color = 'Yellow';   $prefix = '[WARN] ' }
        'ERROR'  { $color = 'Red';      $prefix = '[ERROR]' }
        'DEBUG'  { $color = 'DarkGray'; $prefix = '[DBG]  ' }
        'STEP'   { $color = 'Magenta';  $prefix = '[....] ' }
        'BANNER' { $color = 'White';    $prefix = $null }
    }

    # Console output
    if ($Level -eq 'BANNER') {
        if ($NoNewline) {
            Write-Host $Message -ForegroundColor $color -NoNewline
        } else {
            Write-Host $Message -ForegroundColor $color
        }
    } else {
        $line = "[$timeStamp] $prefix $Message"
        if ($NoNewline) {
            Write-Host $line -ForegroundColor $color -NoNewline
        } else {
            Write-Host $line -ForegroundColor $color
        }
    }

    # File output — ensure log directory exists
    if ($null -ne $script:LogFile) {
        $logDir = Split-Path $script:LogFile -Parent
        if (-not (Test-Path $logDir)) {
            $null = New-Item -ItemType Directory -Path $logDir -Force
        }
        $fileLevel = $Level.PadRight(6)
        $fileLine  = "[$dateTime] [$fileLevel] $Message"
        try {
            Add-Content -Path $script:LogFile -Value $fileLine -Encoding UTF8
        } catch {
            # Silently ignore log-file write errors to not break the launcher
        }
    }
}

# Initialise log file path (needs $PSScriptRoot, so done after functions are defined)
$script:LogFile = Join-Path $PSScriptRoot "logs\simplelauncher_$(Get-Date -Format 'yyyy-MM-dd').log"
$logDir = Split-Path $script:LogFile -Parent
if (-not (Test-Path $logDir)) {
    $null = New-Item -ItemType Directory -Path $logDir -Force
}

# ─── Port helpers ─────────────────────────────────────────────────────────────
function Test-PortAvailable {
    param([int]$Port)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Get-PIDOnPort {
    param([int]$Port)
    try {
        $netstatOutput = & netstat -ano 2>$null
        foreach ($line in $netstatOutput) {
            if ($line -match ":$Port\s+.*LISTENING\s+(\d+)") {
                return [int]$Matches[1]
            }
        }
    } catch {
        # ignore
    }
    return $null
}

# ─── Main try/catch/finally ────────────────────────────────────────────────────
try {

    # ── Banner ────────────────────────────────────────────────────────────────
    Write-Log '==========================================' -Level BANNER
    Write-Log '   PupCid''s Little TikTool Helper'         -Level BANNER
    Write-Log '   Simple Launcher v1.0 (PowerShell)'       -Level BANNER
    Write-Log '==========================================' -Level BANNER
    Write-Log ''                                            -Level BANNER

    Write-Log "Launcher started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level INFO
    Write-Log "Script location: $PSScriptRoot"                                -Level INFO

    # ── Step 1: System checks ─────────────────────────────────────────────────
    Write-Log 'Checking system requirements...' -Level STEP

    # 1a. PowerShell version
    $psVer = $PSVersionTable.PSVersion.Major
    if ($psVer -lt 5) {
        Write-Log "PowerShell $psVer detected — version < 5, some features may not work" -Level WARN
    } else {
        Write-Log "PowerShell $($PSVersionTable.PSVersion) detected" -Level INFO
    }

    # 1b. Windows check
    $isWin = $false
    if ($null -ne (Get-Variable -Name 'IsWindows' -ErrorAction SilentlyContinue)) {
        $isWin = $IsWindows
    } elseif ($env:OS -match 'Windows') {
        $isWin = $true
    }
    if (-not $isWin) {
        Write-Log 'Non-Windows OS detected — some features (browser open, taskkill) may behave differently' -Level WARN
    }

    # 1c. Node.js
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCmd) {
        Write-Log 'Node.js not found in PATH.' -Level ERROR
        Write-Log 'Please install Node.js (>= 18) from https://nodejs.org/' -Level ERROR
        Read-Host 'Press Enter to close'
        exit 1
    }

    Write-Log "Node.js found at: $($nodeCmd.Source)" -Level INFO

    $nodeVersionRaw = & node --version 2>&1
    $nodeVersionStr = "$nodeVersionRaw".Trim()
    Write-Log "Node.js version raw: $nodeVersionStr" -Level DEBUG

    $nodeMajor = 0
    if ($nodeVersionStr -match 'v(\d+)') {
        $nodeMajor = [int]$Matches[1]
    }

    if ($nodeMajor -lt 18) {
        Write-Log "Node.js $nodeVersionStr is too old (minimum required: v18). Please update from https://nodejs.org/" -Level ERROR
        Read-Host 'Press Enter to close'
        exit 1
    } elseif ($nodeMajor -lt 20) {
        Write-Log "Node.js $nodeVersionStr found (recommended: >= v20)" -Level WARN
    }

    Write-Log "Node.js $nodeVersionStr found at $($nodeCmd.Source)" -Level OK

    # 1d. npm
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($null -ne $npmCmd) {
        $npmVersionRaw = & npm --version 2>&1
        Write-Log "npm v$("$npmVersionRaw".Trim()) found" -Level OK
    } else {
        Write-Log 'npm not found — it is normally bundled with Node.js' -Level WARN
    }

    # ── Step 2: Project structure ──────────────────────────────────────────────
    Write-Log 'Checking project structure...' -Level STEP

    $appDir       = Join-Path $PSScriptRoot 'app'
    $serverJs     = Join-Path $appDir 'server.js'
    $packageJson  = Join-Path $appDir 'package.json'
    $envFile      = Join-Path $appDir '.env'
    $nodeModules  = Join-Path $appDir 'node_modules'

    # Mandatory paths
    foreach ($item in @(
        @{ Path = $appDir;      Label = 'app\' },
        @{ Path = $serverJs;    Label = 'app\server.js' },
        @{ Path = $packageJson; Label = 'app\package.json' }
    )) {
        if (Test-Path $item.Path) {
            Write-Log "$($item.Label) exists" -Level OK
        } else {
            Write-Log "$($item.Label) not found — cannot continue" -Level ERROR
            exit 1
        }
    }

    # Optional: .env
    if (Test-Path $envFile) {
        Write-Log 'app\.env exists' -Level OK
    } else {
        Write-Log 'app\.env not found — copy app\.env.example to app\.env and fill in your settings' -Level WARN
    }

    # Optional: node_modules (info only — handled in step 3)
    if (-not (Test-Path $nodeModules)) {
        Write-Log 'app\node_modules\ not found — will install dependencies' -Level INFO
    } else {
        Write-Log 'app\node_modules\ exists' -Level OK
    }

    # ── Step 3: Dependencies ───────────────────────────────────────────────────
    Write-Log 'Checking dependencies...' -Level STEP

    $needInstall = $false

    if (-not (Test-Path $nodeModules)) {
        Write-Log 'node_modules not found — running npm install...' -Level INFO
        $needInstall = $true
    } else {
        Write-Log 'Dependencies already installed' -Level OK
        # Compare mtime of package.json vs node_modules
        $pkgMtime = (Get-Item $packageJson).LastWriteTime
        $modMtime = (Get-Item $nodeModules).LastWriteTime
        if ($pkgMtime -gt $modMtime) {
            Write-Log 'package.json changed since last install — running npm install...' -Level WARN
            $needInstall = $true
        } else {
            Write-Log 'Dependencies up to date (skip install)' -Level OK
        }
    }

    if ($needInstall) {
        $env:YOUTUBE_DL_SKIP_PYTHON_CHECK   = '1'
        $env:PUPPETEER_SKIP_DOWNLOAD        = 'true'
        $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
        $env:npm_config_optional            = 'false'

        Push-Location $appDir
        try {
            $ErrorActionPreference = 'Stop'
            $proc = Start-Process npm -ArgumentList 'install' -Wait -PassThru -NoNewWindow
            if ($proc.ExitCode -ne 0) {
                Write-Log "npm install failed with exit code $($proc.ExitCode)" -Level ERROR
                Pop-Location
                exit 1
            }
        } catch {
            Write-Log "npm install encountered an error: $_" -Level ERROR
            Pop-Location
            exit 1
        } finally {
            $ErrorActionPreference = 'Continue'
        }
        Pop-Location
        Write-Log 'Dependencies installed successfully' -Level OK
    }

    # ── Step 4: Port resolution ────────────────────────────────────────────────
    Write-Log 'Resolving port...' -Level STEP

    $fallbackPorts = @(3001, 3002, 3003, 3004, 3005, 3010, 3100, 8080, 8888)
    $allPorts      = @($PreferredPort) + $fallbackPorts
    $portFound     = $false

    foreach ($candidatePort in $allPorts) {
        Write-Log "Testing port $candidatePort..." -Level DEBUG

        if (Test-PortAvailable -Port $candidatePort) {
            $script:ResolvedPort = $candidatePort
            Write-Log "Port $candidatePort is free" -Level OK
            $portFound = $true
            break
        }

        # Port is busy — check if it's an old LTTH instance
        $pidOnPort = Get-PIDOnPort -Port $candidatePort
        $isLTTH    = $false

        try {
            $ErrorActionPreference = 'Stop'
            $httpClient = [System.Net.WebClient]::new()
            $httpClient.Headers.Add('User-Agent', 'LTTH-Launcher/1.0')
            # Short timeout workaround via WebRequest
            $wr = [System.Net.HttpWebRequest]::Create("http://localhost:$candidatePort/api/health")
            $wr.Timeout  = 2000
            $wr.Method   = 'GET'
            $resp        = $wr.GetResponse()
            $reader      = [System.IO.StreamReader]::new($resp.GetResponseStream())
            $jsonText    = $reader.ReadToEnd()
            $reader.Close()
            $resp.Close()

            # Simple JSON property check without requiring ConvertFrom-Json
            if ($jsonText -match '"status"\s*:\s*"ok"' -and
                ($jsonText -match 'LTTH' -or $jsonText -match 'TikTok')) {
                $isLTTH = $true
            }
        } catch {
            # No response or non-LTTH service
        } finally {
            $ErrorActionPreference = 'Continue'
        }

        if ($isLTTH -and $null -ne $pidOnPort) {
            Write-Log "Old LTTH instance detected on port $candidatePort (PID: $pidOnPort)" -Level WARN

            # Ask user with 10s auto-yes timeout
            $killIt = $false
            Write-Host "  Kill old instance? [Y/n] (auto-Yes in 10s): " -NoNewline -ForegroundColor Yellow

            $answer = $null
            $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            while ($stopwatch.Elapsed.TotalSeconds -lt 10) {
                if ([Console]::KeyAvailable) {
                    $key = [Console]::ReadKey($true)
                    $answer = $key.KeyChar.ToString().ToLower()
                    Write-Host $answer
                    break
                }
                Start-Sleep -Milliseconds 200
            }
            $stopwatch.Stop()

            if ($null -eq $answer -or $answer -eq '') {
                Write-Host '(auto-Yes)'
                $killIt = $true
            } elseif ($answer -eq 'y' -or $answer -eq '') {
                $killIt = $true
            }

            if ($killIt) {
                Write-Log "Killing PID $pidOnPort..." -Level INFO
                try {
                    $ErrorActionPreference = 'Stop'
                    & taskkill /PID $pidOnPort /F /T 2>&1 | Out-Null
                } catch {
                    Write-Log "taskkill failed: $_" -Level WARN
                } finally {
                    $ErrorActionPreference = 'Continue'
                }

                # Wait up to 5s for port to become free
                $waited = 0
                while ($waited -lt 5) {
                    Start-Sleep -Milliseconds 500
                    $waited += 0.5
                    if (Test-PortAvailable -Port $candidatePort) {
                        $script:ResolvedPort = $candidatePort
                        Write-Log "Port $candidatePort is now free" -Level OK
                        $portFound = $true
                        break
                    }
                }
                if ($portFound) { break }
            } else {
                Write-Log "Port $candidatePort skipped by user — trying next..." -Level INFO
            }
        } else {
            Write-Log "Port $candidatePort is busy (non-LTTH process), trying next..." -Level INFO
        }
    }

    if (-not $portFound) {
        Write-Log "No free port found. Please free one of: $($allPorts -join ', ')" -Level ERROR
        exit 1
    }

    Write-Log "Using port: $($script:ResolvedPort)" -Level INFO

    # ── Step 5: Environment variables ─────────────────────────────────────────
    $env:PORT            = "$($script:ResolvedPort)"
    $env:NODE_ENV        = 'production'
    $env:OPEN_BROWSER    = 'false'
    $env:DISABLE_SWAGGER = 'false'

    Write-Log "PORT=$($env:PORT)"             -Level DEBUG
    Write-Log "NODE_ENV=$($env:NODE_ENV)"     -Level DEBUG
    Write-Log "OPEN_BROWSER=$($env:OPEN_BROWSER)" -Level DEBUG

    # ── Step 6 prep: Info box BEFORE blocking server start ────────────────────
    Write-Log 'Starting LTTH server on port ' -Level STEP -NoNewline
    Write-Host $script:ResolvedPort -ForegroundColor Cyan

    Write-Host ''
    Write-Host '------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  LTTH is starting...'                      -ForegroundColor White
    Write-Host "  Dashboard : http://localhost:$($script:ResolvedPort)"          -ForegroundColor Cyan
    Write-Host "  API Docs  : http://localhost:$($script:ResolvedPort)/api-docs" -ForegroundColor Cyan
    Write-Host "  Port      : $($script:ResolvedPort)"                           -ForegroundColor Cyan
    Write-Host '  PID       : (will be known after start)'  -ForegroundColor DarkGray
    Write-Host '------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  Press Ctrl+C to stop the server'          -ForegroundColor Yellow
    Write-Host '------------------------------------------' -ForegroundColor DarkGray
    Write-Host ''

    # ── Step 6: Browser + readiness background jobs ───────────────────────────
    $browserUrl = "http://localhost:$($script:ResolvedPort)"

    Write-Log "Browser will open in 3.5 seconds: $browserUrl" -Level INFO

    $browserJob = Start-Job -ScriptBlock {
        param($url)
        Start-Sleep -Milliseconds 3500
        Start-Process $url
    } -ArgumentList $browserUrl

    $resolvedPortForJob = $script:ResolvedPort
    $readinessJob = Start-Job -ScriptBlock {
        param($port)
        $maxAttempts = 30
        $attempt     = 0
        $ready       = $false
        while ($attempt -lt $maxAttempts) {
            Start-Sleep -Milliseconds 500
            $attempt++
            try {
                $wr      = [System.Net.HttpWebRequest]::Create("http://localhost:$port/api/health")
                $wr.Timeout = 1500
                $wr.Method  = 'GET'
                $resp    = $wr.GetResponse()
                $resp.Close()
                $ready = $true
                break
            } catch {
                # not ready yet
            }
        }
        return $ready
    } -ArgumentList $resolvedPortForJob

    # Monitor readiness job in background (fire-and-forget follow-up check)
    # We'll log once readiness completes after the server exits or on completion
    # (The job runs independently; we receive its output in finally/after node exits)

    # ── Step 6: Start server (blocking) ───────────────────────────────────────
    Push-Location $appDir
    try {
        $ErrorActionPreference = 'Stop'
        & node server.js
    } catch {
        if ($_.Exception.Message -notmatch 'terminated') {
            Write-Log "Server exited with error: $_" -Level ERROR
        }
    } finally {
        $ErrorActionPreference = 'Continue'
        # Ensure we're back in the script root after node exits
        if ((Get-Location).Path -eq $appDir) {
            Pop-Location
        }
    }

} catch {
    Write-Log "Unhandled error: $_" -Level ERROR
} finally {
    # Check readiness job result if completed
    if ($null -ne $readinessJob) {
        $readinessJob | Wait-Job -Timeout 1 | Out-Null
        $jobState = $readinessJob.State
        if ($jobState -eq 'Completed') {
            $wasReady = Receive-Job -Job $readinessJob
            if ($wasReady) {
                Write-Log 'Server was ready and responding' -Level OK
            } else {
                Write-Log 'Server did not respond within 15s — check logs' -Level WARN
            }
        }
        Remove-Job -Job $readinessJob -Force -ErrorAction SilentlyContinue
    }

    if ($null -ne $browserJob) {
        Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
    }

    # Pop-Location safety (idempotent if stack already empty)
    try { Pop-Location -ErrorAction SilentlyContinue } catch { }

    Write-Log 'Launcher exited.' -Level INFO
    Write-Log "Logfile: $script:LogFile" -Level INFO
}

# ── Final pause ────────────────────────────────────────────────────────────────
if (-not $NoPause) {
    Write-Host ''
    Read-Host 'Press Enter to close'
}
