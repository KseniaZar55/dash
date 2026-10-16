@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo CINÉ CLUB — запуск
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher py не найден. Установи Python 3.10+ и включи Add Python to PATH.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Не найден файл .env. Создай его на основе .env.example и вставь OMDb API-ключ.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" py -m venv .venv
call .venv\Scripts\activate.bat
py -m pip install -r requirements.txt
if errorlevel 1 (
  echo Не удалось установить зависимости. Проверь интернет и повтори запуск.
  pause
  exit /b 1
)
echo Открой http://127.0.0.1:8000 в браузере. Чтобы остановить сайт, нажми Ctrl+C.
py -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
