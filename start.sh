#!/usr/bin/env bash
# 星守の夜 — 起動スクリプト（Linux / macOS / WSL）
cd "$(dirname "$0")" || exit 1
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
command -v "$PY" >/dev/null 2>&1 || { echo "Python が見つかりません。https://www.python.org/ からインストールしてください。"; exit 1; }
exec "$PY" server.py
