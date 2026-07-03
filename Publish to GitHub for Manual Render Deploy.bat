@echo off
setlocal
cd /d "%~dp0"

echo Uploading dashboard changes to GitHub...
echo Render auto-deploy is ON, so GitHub upload will trigger Render automatically.
echo.

git config user.name "Vipul"
git config user.email "vipulavnee@users.noreply.github.com"

git add -u
git add -- package.json render.yaml server-cricket.js server-other-sports.js public\cricket-dashboard.html public\other-sports-dashboard.html "Start Cricket Dashboard.bat" "Start Other Sports Dashboard.bat" "Publish Cricket Dashboard to Render.bat" "Publish to GitHub for Manual Render Deploy.bat" "Auto Publish to Render Watcher.bat" auto-publish-render-watcher.ps1

git diff --cached --quiet
if not errorlevel 1 goto :push

git commit -m "Update dashboards for Render"
if errorlevel 1 goto :failed

:push
git push origin main
if errorlevel 1 goto :failed

echo.
echo Uploaded to GitHub successfully.
echo Render should auto-deploy now.
echo.
echo Cricket URL:
echo https://womens-t20-world-cup-dashboard.onrender.com/cricket-dashboard.html
echo.
echo Other Sports URL:
echo https://other-sports-dashboard.onrender.com/other-sports-dashboard.html
echo.
pause
exit /b 0

:failed
echo.
echo Upload failed. Check the message above.
pause
exit /b 1
