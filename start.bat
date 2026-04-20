@echo off
set "ROOT=%~dp0"
start "Backend" cmd /k "cd /d %ROOT%backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"
timeout /t 3 /nobreak >nul
start "Frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"
