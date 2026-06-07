@echo off
REM Build script for LTTH launcher binaries
REM This script builds the launchers and thin bootstrapper for Windows

echo ================================================
echo   LTTH Launcher Build Script
echo ================================================
echo.

where go >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Go is not installed
    echo Please install Go 1.18 or higher from https://golang.org/
    pause
    exit /b 1
)

echo Go version:
go version
echo.

cd /d "%~dp0"
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"

echo Installing dependencies...
go mod download
go mod verify
echo.

echo Building launcher.exe (Windows GUI)...
go build -o "%PROJECT_ROOT%\launcher.exe" -ldflags "-H windowsgui -s -w" launcher-gui.go sysproc_windows.go
if %errorlevel% neq 0 (
    echo Error building launcher.exe
    pause
    exit /b 1
)
echo Built launcher.exe
echo.

echo Building launcher-console.exe (Windows CLI)...
go build -o "%PROJECT_ROOT%\launcher-console.exe" -ldflags "-s -w" launcher.go
if %errorlevel% neq 0 (
    echo Error building launcher-console.exe
    pause
    exit /b 1
)
echo Built launcher-console.exe
echo.

echo Building dev_launcher.exe (Windows GUI with console)...
go build -o "%PROJECT_ROOT%\dev_launcher.exe" -ldflags "-s -w" dev-launcher.go
if %errorlevel% neq 0 (
    echo Error building dev_launcher.exe
    pause
    exit /b 1
)
echo Built dev_launcher.exe
echo.

echo Building ltth-bootstrapper.exe (Windows thin installer)...
go build -o "%PROJECT_ROOT%\ltth-bootstrapper.exe" -ldflags "-H windowsgui -s -w" bootstrapper.go
if %errorlevel% neq 0 (
    echo Error building ltth-bootstrapper.exe
    pause
    exit /b 1
)
echo Built ltth-bootstrapper.exe
echo.

echo ================================================
echo   Build Complete!
echo ================================================
echo.

cd /d "%PROJECT_ROOT%"
echo launcher.exe:
dir launcher.exe | find "launcher.exe"
echo.
echo launcher-console.exe:
dir launcher-console.exe | find "launcher-console.exe"
echo.
echo dev_launcher.exe:
dir dev_launcher.exe | find "dev_launcher.exe"
echo.
echo ltth-bootstrapper.exe:
dir ltth-bootstrapper.exe | find "ltth-bootstrapper.exe"
echo.

echo All launchers built successfully!
echo.
pause
