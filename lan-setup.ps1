# =============================================================
#  星守の夜 — WSL2 を同一WiFiの別端末へ公開する（Windows用）
#
#  WSL2 は既定で NAT のため、別端末は Windows 経由でしか
#  WSL内のサーバーに届きません。このスクリプトは
#  「Windows:ポート → WSL:ポート」のポート転送と
#  ファイアウォール許可を設定します。
#
#  使い方（管理者PowerShell で実行）:
#     powershell -ExecutionPolicy Bypass -File lan-setup.ps1
#     powershell -ExecutionPolicy Bypass -File lan-setup.ps1 -Port 8080
#     powershell -ExecutionPolicy Bypass -File lan-setup.ps1 -Remove   # 解除
# =============================================================
param(
    [int]$Port = 8000,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'

# 管理者チェック
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host '管理者権限の PowerShell で実行してください。' -ForegroundColor Red
    Write-Host '（スタート→PowerShell を右クリック→「管理者として実行」）' -ForegroundColor Yellow
    exit 1
}

$ruleName = "Hoshimori $Port"

if ($Remove) {
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port 2>$null | Out-Null
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    Write-Host "ポート $Port の公開を解除しました。" -ForegroundColor Green
    exit 0
}

# WSL の現在IPを取得（再起動で変わるため毎回取得）
$wslIp = (wsl hostname -I).Trim().Split(' ')[0]
if (-not $wslIp) { Write-Host 'WSL の IP を取得できませんでした。WSL が起動しているか確認してください。' -ForegroundColor Red; exit 1 }

# ポート転送（既存を消してから追加）
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$Port connectaddress=$wslIp connectport=$Port

# ファイアウォール許可
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow | Out-Null
}

# Windows の LAN IP を表示
$lan = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.1*' } |
    Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ""
Write-Host "公開しました： Windows:$Port  →  WSL($wslIp):$Port" -ForegroundColor Green
Write-Host "別端末から（マウス/タッチ）： http://$lan`:$Port/" -ForegroundColor Cyan
Write-Host "別端末でカメラも使う場合  ： https://$lan`:$Port/  ※サーバーは HTTPS=1 で起動" -ForegroundColor Cyan
Write-Host ""
Write-Host "解除するには： lan-setup.ps1 -Remove" -ForegroundColor DarkGray
