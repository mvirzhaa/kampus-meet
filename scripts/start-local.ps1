# Script untuk menjalankan UIKA Meet dan LiveKit Server secara lokal
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Memulai UIKA Meet & LiveKit SFU Lokal   " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$livekitBin = ".\bin\livekit-server.exe"

if (-not (Test-Path $livekitBin)) {
    Write-Host "[!] Binary LiveKit belum ditemukan di .\bin\livekit-server.exe" -ForegroundColor Yellow
    Write-Host "    Silakan unduh dari GitHub Releases atau gunakan Docker." -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/2] Menjalankan LiveKit Server (Port 7880)..." -ForegroundColor Green
$lkProcess = Start-Process -FilePath $livekitBin -ArgumentList "--config deploy\livekit.dev.yaml" -PassThru -NoNewWindow

Start-Sleep -Seconds 1

Write-Host "[2/2] Menjalankan Node.js App (http://localhost:3000)..." -ForegroundColor Green
Write-Host "Tekan Ctrl+C untuk menghentikan server." -ForegroundColor Yellow

try {
    node --disable-warning=ExperimentalWarning server/index.js
}
finally {
    Write-Host "`n[i] Menghentikan LiveKit Server..." -ForegroundColor DarkGray
    if ($lkProcess -and -not $lkProcess.HasExited) {
        Stop-Process -Id $lkProcess.Id -Force
    }
}
