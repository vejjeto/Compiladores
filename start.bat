@echo off
title Sistema de Control Robótico
echo ========================================
echo   SISTEMA DE CONTROL ROBOTICO
echo   Backend (Puerto 3000)
echo ========================================
echo.
echo Instalando dependencias...
cd /d "%~dp0"
call npm install --prefix Backend
call npm install --prefix simulador
call npm install
echo.
echo Iniciando servidores...
echo   Aplicación disponible en: http://localhost:3000
echo.
call npx concurrently "npm start --prefix Backend" "npm start --prefix simulador"
