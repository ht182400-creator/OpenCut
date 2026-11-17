@echo off
rem ============================================
rem OpenCut Web 开发服务器启动脚本
rem 功能：终止占用指定端口的老进程后，重新启动 Vite 开发服务器
rem 用法：双击本文件，或在项目根目录执行 start-web.bat
rem ============================================
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ---- 可配置项（提取为常量，便于后续调整） ----
set "DEV_PORT=5173"
set "WEB_DIR=%~dp0apps\web"
set "VITE_ENTRY=%WEB_DIR%\node_modules\vite\bin\vite.js"

echo [启动] 检查端口 %DEV_PORT% 上的老进程...

rem 用 netstat 精确定位监听该端口的 PID，避免误杀 3000/3001 等其他端口上的服务
set "KILL_COUNT=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%DEV_PORT% " ^| findstr "LISTENING"') do (
    if not "%%p"=="0" (
        taskkill /F /PID %%p >nul 2>&1
        if !errorlevel! equ 0 (
            echo [启动] 已终止老进程 PID=%%p
            set /a KILL_COUNT+=1
        )
    )
)
if %KILL_COUNT% equ 0 echo [启动] 端口 %DEV_PORT% 未被占用

rem 清理抢不到端口的孤儿 vite 进程（命令行同时含 vite.js 与本端口），避免多次重启残留
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vite\.js' -and $_.CommandLine -match '(--port\s+%DEV_PORT%)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

rem 等待端口完全释放，避免新实例因端口占用启动失败
timeout /t 1 /nobreak >nul

cd /d "%WEB_DIR%"

if not exist "%VITE_ENTRY%" (
    echo [错误] 未找到 Vite 入口：%VITE_ENTRY%
    echo [错误] 请先在 %WEB_DIR% 下安装依赖后再启动
    exit /b 1
)

echo [启动] 工作目录：%WEB_DIR%
echo [启动] 访问地址：http://localhost:%DEV_PORT%/
echo [启动] 按 Ctrl+C 停止服务
echo.

node "%VITE_ENTRY%" dev --port %DEV_PORT%

endlocal
