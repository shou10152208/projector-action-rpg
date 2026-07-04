#!/usr/bin/env python3
# =============================================================
#  星守の夜 — ローカル/LAN 配信サーバー
#  - ES Modules (.mjs) / WASM (.wasm) を正しい MIME で配信
#  - Cross-Origin Isolation ヘッダ（WASMスレッド高速化）
#  - 0.0.0.0 で待ち受け、同一WiFiの別端末からアクセス可
#  - HTTPS=1 で自己署名HTTPSを起動（別端末でもカメラが使える）
#
#  使い方:
#    python3 server.py            # HTTP（別端末はマウス/タッチ操作）
#    HTTPS=1 python3 server.py    # HTTPS（別端末でもカメラが使える）
#    PORT=8080 python3 server.py  # ポート変更
# =============================================================

import http.server
import os
import platform
import socket
import ssl
import subprocess
import sys
import threading
import webbrowser

PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")
USE_HTTPS = os.environ.get("HTTPS", "").lower() in ("1", "true", "yes", "on")
DIR = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(DIR, "certs")
CERT = os.path.join(CERT_DIR, "cert.pem")
KEY = os.path.join(CERT_DIR, "key.pem")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html; charset=utf-8",
        ".task": "application/octet-stream",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        err = sys.exc_info()[1]
        if isinstance(err, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, ssl.SSLError)):
            return
        super().handle_error(request, client_address)


def local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    ips.discard("127.0.0.1")
    return sorted(ips)


def ensure_cert():
    """openssl で自己署名証明書を生成（無ければ）。SANにlocalhost/各IPを含める。"""
    if os.path.exists(CERT) and os.path.exists(KEY):
        return True
    os.makedirs(CERT_DIR, exist_ok=True)
    sans = ["DNS:localhost", "IP:127.0.0.1"]
    for ip in local_ips():
        sans.append(f"IP:{ip}")
    lan = os.environ.get("LAN_IP")
    if lan:
        sans.append(f"IP:{lan}")
    cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", KEY, "-out", CERT, "-days", "825", "-nodes",
        "-subj", "/CN=hoshimori.local",
        "-addext", "subjectAltName=" + ",".join(sans),
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"自己署名証明書を生成しました: {CERT}")
        return True
    except Exception as e:
        print(f"証明書の生成に失敗しました（opensslが必要）: {e}")
        return False


def is_wsl():
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        return "microsoft" in platform.uname().release.lower()
    except Exception:
        return False


def open_browser(url):
    if is_wsl():
        for cmd in (
            ["cmd.exe", "/c", "start", "", url],
            ["wslview", url],
            ["powershell.exe", "-NoProfile", "-Command", f'Start-Process "{url}"'],
        ):
            try:
                subprocess.Popen(cmd, cwd="/mnt/c", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except Exception:
                continue
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main():
    os.chdir(DIR)
    scheme = "https" if USE_HTTPS else "http"

    if USE_HTTPS and not ensure_cert():
        print("HTTPSを諦めてHTTPで起動します。")
        scheme = "http"
        use_https = False
    else:
        use_https = USE_HTTPS

    try:
        httpd = Server((HOST, PORT), Handler)
    except OSError as e:
        print(f"ポート {PORT} を使用できません: {e}")
        print("別ポートで再試行: PORT=8080 python3 server.py")
        return

    if use_https:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    local = f"{scheme}://localhost:{PORT}/"
    print("=" * 56)
    print("   星守の夜  —  STARFALL GUARDIANS")
    print(f"   この端末      : {local}")
    for ip in local_ips():
        print(f"   別端末から    : {scheme}://{ip}:{PORT}/")
    if is_wsl():
        print("   ※WSLの場合、別端末からのLAN接続には Windows 側の")
        print("     ポート転送が必要です → 管理者PowerShellで lan-setup.ps1")
    if not use_https:
        print("   ※別端末でカメラを使うには HTTPS=1 で起動してください")
    print("   停止 : Ctrl + C")
    print("=" * 56)
    sys.stdout.flush()

    threading.Timer(1.0, lambda: open_browser(local)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました。おつかれさまでした。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
