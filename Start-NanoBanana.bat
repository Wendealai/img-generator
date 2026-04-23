@echo off
chcp 65001 >nul
title NanoBanana Dev Server

cd /d "C:\Webapps\Nanobanana"
if errorlevel 1 (
  echo [ERROR] Project path not found: C:\Webapps\Nanobanana
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting NanoBanana dev server at http://127.0.0.1:4173 ...
start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:4173'"
call npm run dev -- --host 127.0.0.1 --port 4173 --strictPort

echo.
echo Dev server stopped.
pause
