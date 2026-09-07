[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$env:SOULSEEK_DEV = "1"

Write-Host "Iniciando backend Flask con recarga automática..."
$backend = Start-Process `
    -FilePath "py" `
    -ArgumentList @("-3.13", (Join-Path $Root "spotify_web.py")) `
    -WorkingDirectory $Root `
    -PassThru `
    -NoNewWindow

try {
    Push-Location (Join-Path $Root "spotify-soulseek-web")
    Write-Host "Iniciando Vite con HMR en http://127.0.0.1:5173..."
    npm run dev -- --host 127.0.0.1
} finally {
    Pop-Location
    if ($backend -and -not $backend.HasExited) {
        Write-Host "Deteniendo el backend iniciado por dev.ps1..."
        Stop-Process -Id $backend.Id -Force
    }
}
