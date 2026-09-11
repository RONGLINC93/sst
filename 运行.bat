@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   启动模拟炒股服务器
echo ========================================
echo.

start "" http://localhost:3002
node server.js

echo.
pause
