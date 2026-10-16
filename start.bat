@echo off
title Last Card - keep this window open while you play
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download the LTS version from https://nodejs.org, install it, then double-click start.bat again.
  echo.
  pause
  exit /b 1
)
node server.js
pause
