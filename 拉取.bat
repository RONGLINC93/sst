@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   拉取 GitHub 最新代码
echo ========================================
echo.

node pull.js

echo.
pause
