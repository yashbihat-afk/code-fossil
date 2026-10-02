@echo off
cd /d "%~dp0"
node server.js
start "" "http://localhost:4173"
pause
