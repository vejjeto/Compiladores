@echo off
title Sistema de Control Robótico
echo ========================================
echo   SISTEMA DE CONTROL ROBOTICO
echo   Backend + Frontend
echo ========================================
echo.
echo Instalando dependencias...
cd /d "%~dp0"
call npm install --prefix Backend
call npm install --prefix Frontend
call npm install
echo.
echo Iniciando servidores...
echo   Backend:  ws://localhost:3000  /  wss://localhost:3443
echo   Frontend: http://localhost:8080  /  https://localhost:8443
echo.
call npx concurrently "npm start --prefix Backend" "npm start --prefix Frontend"
