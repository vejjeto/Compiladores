@echo off
title Sistema de Control Robótico
echo ========================================
echo   SISTEMA DE CONTROL ROBOTICO
echo   Backend (Puerto 80 por defecto)
echo ========================================
echo.
echo Instalando dependencias...
cd /d "%~dp0"
call npm install --prefix Backend
call npm install --prefix simulador
call npm install
echo.
echo Iniciando servidores...
echo   Aplicación disponible en: http://localhost
echo.
call npx concurrently "npm start --prefix Backend" "npm start --prefix simulador"
