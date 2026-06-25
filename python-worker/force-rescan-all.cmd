@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe worker.py scan-now --source all --force
pause
