[CmdletBinding()]
param(
    [switch]$Test,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$rootDir = Resolve-Path "$PSScriptRoot\.." | Select-Object -ExpandProperty Path

# Ensure Electron doesn't boot into Node mode if this script was called from an environment where it was set
$env:ELECTRON_RUN_AS_NODE = $null

Write-Host "Starting LTTH Build Pipeline..." -ForegroundColor Cyan

Set-Location $rootDir

if ($Clean) {
    Write-Host "-> Cleaning up build artifacts..." -ForegroundColor Yellow
    
    # Remove distribution directory
    if (Test-Path "dist") {
        Write-Host "   - Removing dist/" -ForegroundColor Gray
        Remove-Item -Path "dist" -Recurse -Force
    }
    
    # Remove any stray logs from backend
    if (Test-Path "source\backend\test_server.log") {
        Remove-Item -Path "source\backend\test_server.log" -Force
    }

    # Clean legacy app directory if it exists to prevent contamination
    if (Test-Path "app") {
        Write-Host "   - Removing legacy app/ directory" -ForegroundColor Gray
        Remove-Item -Path "app" -Recurse -Force
    }

    Write-Host "Cleanup complete." -ForegroundColor Green
}

Write-Host "1. Building TypeScript..." -ForegroundColor Yellow
npm run build:ts

Write-Host "2. Building CSS via Tailwind..." -ForegroundColor Yellow
npm run build:css

Write-Host "3. Synchronizing Static Assets to Dist..." -ForegroundColor Yellow
$foldersToCopy = @("public", "plugins", "tts", "locales", "user_configs")
foreach ($folder in $foldersToCopy) {
    $src = Join-Path $rootDir "source\backend\$folder"
    $dest = Join-Path $rootDir "dist\backend\$folder"
    
    if (Test-Path $src) {
        if (Test-Path $dest) {
            Remove-Item -Path $dest -Recurse -Force
        }
        Copy-Item -Path $src -Destination $dest -Recurse -Force
        Write-Host "   - Copied $folder/" -ForegroundColor Gray
    }
}

Write-Host "   - Copying Root Assets (*.png, *.jpg)..." -ForegroundColor Gray
$assetFiles = Get-ChildItem -Path (Join-Path $rootDir "source\backend") -Include *.png, *.jpg -File
foreach ($file in $assetFiles) {
    Copy-Item $file.FullName -Destination (Join-Path $rootDir "dist\backend") -Force
}

Write-Host "   - Copying Build Icons..." -ForegroundColor Gray
$mainBuildDir = Join-Path $rootDir "dist\main\build"
if (-not (Test-Path $mainBuildDir)) {
    New-Item -ItemType Directory -Path $mainBuildDir -Force | Out-Null
}
Copy-Item (Join-Path $rootDir "source\backend\ltthappicon.png") -Destination (Join-Path $mainBuildDir "icon.png") -Force
Copy-Item (Join-Path $rootDir "source\backend\ltthappicon.png") -Destination (Join-Path $mainBuildDir "tray-icon.png") -Force

if ($Test) {
    Write-Host "4. Testing the Dashboard with Playwright..." -ForegroundColor Cyan
    
    # Kill process gracefully occupying port 3000
    Write-Host "-> Checking for Port 3000 Conflicts..." -ForegroundColor Yellow
    $portProcs = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
    if ($portProcs) {
        Write-Host "Found processes on Port 3000. Killing them..." -ForegroundColor Red
        $portProcs | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            Write-Host "-> Killed process ID $_"
        }
        Start-Sleep -Seconds 2
    }

    # Start the backend server
    Write-Host "-> Starting Node Server background process..." -ForegroundColor Yellow
    Set-Location "$rootDir\source\backend"
    # Use CMD to explicitly hoist the NODE_PATH, reliably starting the built typescript server cleanly
    $electronNode = Join-Path $rootDir "node_modules\electron\dist\electron.exe"
    $rootModules = Join-Path $rootDir "node_modules"
    $serverProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"set ELECTRON_RUN_AS_NODE=1&& set NODE_PATH=$rootModules&& `"$electronNode`" ../../dist/backend/server.js > test_server.log 2>&1`"" -PassThru -WindowStyle Hidden
    Set-Location $rootDir
    
    Write-Host "-> Waiting for server to initialize..." -ForegroundColor Gray
    Start-Sleep -Seconds 8

    # Create the playwright verification script
    $pwScriptPath = Join-Path $rootDir "scripts\verify-dashboard.js"
    $pwCode = @"
const { chromium } = require('playwright');
(async () => {
    console.log('🚀 Launching Playwright Chromium...');
    try {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        console.log('--------------------------------------------------');
        console.log('🖥️ INITIALIZING DASHBOARD LOG DUMP OVER 5 SECONDS 🖥️');
        console.log('--------------------------------------------------');
        
        // Listen to console and page errors
        page.on('console', msg => {
            console.log('[' + msg.type().toUpperCase() + '] ' + msg.text());
        });
        page.on('pageerror', err => {
            console.log('[PAGE CRASH]', err.message);
        });

        console.log('📡 Navigating to dashboard.html...');
        await page.goto('http://localhost:3000/dashboard.html');
        
        // Wait required initialization time
        await page.waitForTimeout(5000);
        
        console.log('--------------------------------------------------');
        console.log('✅ PAGE LOG DUMP COMPLETE ✅');
        console.log('--------------------------------------------------');
        await browser.close();
        process.exit(0);
    } catch (e) {
        console.error('Test script crash:', e);
        process.exit(1);
    }
})();
"@
    Set-Content -Path $pwScriptPath -Value $pwCode
    
    Write-Host "-> Running Browser Verification Script..." -ForegroundColor Yellow
    node $pwScriptPath

    # Clean up the server
    Write-Host "-> Cleaning up server process..." -ForegroundColor Yellow
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    $portProcs = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
    if ($portProcs) {
        $portProcs | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host "4. Packaging with Electron-Builder..." -ForegroundColor Cyan
    npm run build:electron
}

Write-Host "Pipeline execution finished successfully!" -ForegroundColor Green
