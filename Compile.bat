@echo off
title Influence Launcher Compilation Tool
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "Compile.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [!] Произошла ошибка при выполнении скрипта.
    pause
)
