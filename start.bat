@echo off
chcp 65001 >nul
rem 星守の夜 — 起動スクリプト（Windows）
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py server.py
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto :eof
)
echo Python が見つかりません。https://www.python.org/ からインストールしてください。
pause
