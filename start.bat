@echo off
start "Backend" cmd /k "cd /d C:\Users\n4kam\Desktop\fx-strategy-saas\backend && .venv\Scripts\activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"
timeout /t 3 /nobreak >nul
start "Frontend" cmd /k "cd /d C:\Users\n4kam\Desktop\fx-strategy-saas\frontend && npm run dev"
