@echo off
setlocal
cd /d "%~dp0"
echo Starting a local server for the Phase 0 voice-check page at http://localhost:4174
echo If the browser tab shows "can't connect", just reload it once --
echo the server takes a moment to start.
echo.
echo Leave THIS window open. Close it, or press Ctrl+C, to stop the server.
start "" http://localhost:4174
node serve-tools.mjs
