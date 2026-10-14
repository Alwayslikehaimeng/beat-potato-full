# ===========================================================================
# 暴打土豆 · 网页版 —— 一键起本地网址
#
#   用法：在 PowerShell 里执行   .\serve.ps1
#   然后电脑浏览器打开 http://localhost:8765/
#   手机连同一个 WiFi，打开脚本打印出来的 http://192.168.x.x:8765/
#
#   想换端口：  $env:PORT=9000; .\serve.ps1
#   停止：      Ctrl + C
# ===========================================================================

$ErrorActionPreference = 'Stop'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Host ''
    Write-Host '  找不到 Node.js。' -ForegroundColor Red
    Write-Host '  这个本地服务脚本需要 Node 才能跑（只用来起网址，网页本身不依赖 Node）。'
    Write-Host '  装了 Node 之后重新运行本脚本即可；也可以直接用 python -m http.server 8765'
    Write-Host ''
    exit 1
}

Set-Location -LiteralPath $PSScriptRoot

# 顺手检查一下素材是否齐全（web/assets 由 sync-assets.ps1 生成）
$assets = Join-Path $PSScriptRoot 'assets\audio'
if (-not (Test-Path -LiteralPath $assets)) {
    Write-Host ''
    Write-Host '  还没同步素材，先跑一次： .\sync-assets.ps1' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

& $node (Join-Path $PSScriptRoot 'serve.js')
