@echo off
rem ============================================
rem OpenCut Web dev server launcher
rem Kill all leftover Vite processes before starting a single instance.
rem Key point: match by command line containing this project's vite.js,
rem NOT by listen port, because Vite auto-increments to 5174/5175 when the
rem port is taken, which would leave old instances alive and pile up.
rem Usage: double click this file, or run start-web.bat in project root.
rem NOTE: comments stay ASCII-only on purpose. Windows cmd parses .bat with
rem the active code page; non-ASCII comment bytes can be misread as command
rem separators and produce spurious "not recognized" errors.
rem ============================================
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ---- Configurable constants ----
set "DEV_PORT=5173"
set "WEB_DIR=%~dp0apps\web"
set "VITE_ENTRY=%WEB_DIR%\node_modules\vite\bin\vite.js"

echo [START] Cleaning leftover Vite dev server processes

rem ---- Pass 1: match command line containing this project's vite.js, port-independent ----
rem Delegate to clean-vite.ps1 to avoid nested cmd/PowerShell quoting issues.
set "KILL_COUNT=0"
for /f "tokens=2 delims==" %%a in ('powershell -NoProfile -File "%~dp0clean-vite.ps1" -Needle "%VITE_ENTRY%" 2^>nul ^| findstr "KILLED="') do (
    echo [START] Killed Vite process PID=%%a
    set /a KILL_COUNT+=1
)

rem ---- Pass 2: fall back to port listener, covers non-standard launches ----
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%DEV_PORT% " ^| findstr "LISTENING"') do (
    if not "%%p"=="0" (
        taskkill /F /PID %%p >nul 2>&1
        if !errorlevel! equ 0 (
            echo [START] Killed port listener PID=%%p
            set /a KILL_COUNT+=1
        )
    )
)
if %KILL_COUNT% equ 0 echo [START] No leftover process found

rem ---- Wait for port release so the new instance will not auto-increment ----
timeout /t 2 /nobreak >nul

set "PORT_STILL=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%DEV_PORT% " ^| findstr "LISTENING"') do set "PORT_STILL=%%p"
if not "%PORT_STILL%"=="0" (
    echo [ERROR] Port %DEV_PORT% still held by PID=%PORT_STILL%, check manually and retry
    exit /b 1
)

cd /d "%WEB_DIR%"

if not exist "%VITE_ENTRY%" (
    echo [ERROR] Vite entry not found: %VITE_ENTRY%
    echo [ERROR] Install dependencies under %WEB_DIR% first
    exit /b 1
)

echo [START] Workdir  %WEB_DIR%
echo [START] URL      http://localhost:%DEV_PORT%/
echo [START] Press Ctrl+C to stop
echo.

node "%VITE_ENTRY%" dev --port %DEV_PORT%

endlocal
