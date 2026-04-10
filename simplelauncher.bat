@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%simplelauncher.ps1" %*
if %errorlevel% neq 0 pause
endlocal
