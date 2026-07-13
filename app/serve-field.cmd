@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo dist\index.html not found in this folder.
  echo Run "npm run build" first, then re-run this script.
  pause
  exit /b 1
)
echo Starting the Eclipse dashboard server at http://localhost:4173
echo If the browser tab shows "can't connect", just reload it once --
echo the server takes a moment to start.
echo.
echo Leave THIS window open. Close it, or press Ctrl+C, to stop the server.
start "" http://localhost:4173
node_modules\.bin\vite.cmd preview --port 4173 --strictPort
