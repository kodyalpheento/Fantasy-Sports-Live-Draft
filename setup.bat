@echo off
REM Live Draft local setup for Windows. Double-click, or run from a terminal: setup.bat [--start]
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
node scripts\setup-local.mjs %*
pause
