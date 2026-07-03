@echo off
setlocal
cd /d "%~dp0"

echo Starting automatic GitHub publish watcher...
echo Render auto-deploy is ON, so every successful push will trigger Render.
echo Keep this window open. Close it to stop automatic publishing.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-publish-render-watcher.ps1"

echo.
echo Auto publish watcher stopped.
pause
