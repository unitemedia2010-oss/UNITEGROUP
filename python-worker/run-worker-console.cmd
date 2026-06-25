@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe worker.py daemon
pause
