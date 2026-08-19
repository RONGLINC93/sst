@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo   推送代码到 GitHub
echo ========================================
echo.

if "%~1"=="" (
  node push.js
) else (
  node push.js "%~1"
)

echo.
pause
