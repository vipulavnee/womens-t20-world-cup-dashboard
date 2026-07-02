@echo off
setlocal
cd /d "%~dp0"

echo Publishing Cricket Dashboard to Render via GitHub...
git config user.name "Vipul"
git config user.email "vipulavnee@users.noreply.github.com"
git add -u
git add -- package.json render.yaml server-cricket.js server-other-sports.js public\cricket-dashboard.html public\other-sports-dashboard.html "Start Cricket Dashboard.bat" "Start Other Sports Dashboard.bat" "Publish Cricket Dashboard to Render.bat"
git diff --cached --quiet
if not errorlevel 1 goto :push

git commit -m "Update cricket dashboard for Render"
if errorlevel 1 goto :failed

:push
git push origin main
if errorlevel 1 goto :failed

echo.
echo Uploaded to GitHub. Render should redeploy automatically.
echo Wait 2-5 minutes, then hard-refresh the Render page.
pause
exit /b 0

:failed
echo.
echo Upload failed. Check the message above.
pause
exit /b 1
