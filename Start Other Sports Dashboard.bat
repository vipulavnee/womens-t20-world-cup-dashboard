@echo off
title Start Other Sports Dashboard
set "APP_DIR=A:\..monthwise\dashboards\cricket"
set "PORT=3003"
set "LOCAL_URL=http://127.0.0.1:3003/other-sports-dashboard.html"

cd /d "%APP_DIR%"
set "NODE_PATH=%APP_DIR%\node_modules"

echo Starting other sports dashboard from:
echo %APP_DIR%
echo.

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
start "Other Sports Dashboard Server" /min cmd /k "set PORT=%PORT%&& node server-other-sports.js"
timeout /t 3 /nobreak >nul
where msedge >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" msedge --new-window "%LOCAL_URL%?v=%RANDOM%%RANDOM%"
) else (
    start "" "%LOCAL_URL%?v=%RANDOM%%RANDOM%"
)
