@echo off
title Influence Launcher Release Tool
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "CompileDeploy.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [!] Произошла ошибка при выполнении скрипта.
    pause
)
