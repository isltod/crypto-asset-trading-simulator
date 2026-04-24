@echo off
echo Starting local backend server on port 8080...
echo Go to http://localhost:8080/cats/ in your browser.
cd /d "%~dp0"
node server.js
pause
