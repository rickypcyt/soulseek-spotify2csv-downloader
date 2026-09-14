[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Get-ConfiguredSlskdPath {
    $configPath = Join-Path $Root "web_config.json"
    if (-not (Test-Path $configPath)) { return $null }
    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        return [string]$config.slskd_path
    } catch {
        return $null
    }
}

$needsSetup = $false
if (-not (Test-Path (Join-Path $Root "frontend\node_modules"))) {
    $needsSetup = $true
}
$slskdPath = Get-ConfiguredSlskdPath
if (-not $slskdPath -or -not (Test-Path $slskdPath -PathType Leaf)) {
    $needsSetup = $true
}
if (-not $needsSetup) {
    py -3.13 -c "import flask, requests, spotipy, keyring" 2>$null
    if ($LASTEXITCODE -ne 0) { $needsSetup = $true }
}

if ($needsSetup) {
    Write-Host "Falta parte de la configuración. Ejecutando setup automáticamente..."
    & (Join-Path $Root "setup.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Falló la configuración automática."
    }
}

# Levantar backend Flask en background
Write-Host "Iniciando backend Flask (puerto 5000)..."
$backendJob = Start-Job -ScriptBlock {
    param($root)
    Push-Location $root
    try {
        py -3.13 -m backend.spotify_web
    } finally {
        Pop-Location
    }
} -ArgumentList $Root

# Esperar a que el backend esté listo
Write-Host "Esperando al backend..."
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/config" -UseBasicParsing -TimeoutSec 2
        Write-Host "Backend listo."
        break
    } catch {
        if ($i -eq 29) {
            Write-Host "El backend no respondió a tiempo. Revisa los logs:"
            Receive-Job $backendJob
            Stop-Job $backendJob
            throw "Backend no disponible."
        }
    }
}

# Levantar Vite dev server en primer plano (hot reload)
Write-Host "Iniciando Vite dev server (hot reload)..."
Push-Location (Join-Path $Root "frontend")
try {
    npm run dev
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
    # Limpiar backend al salir
    Write-Host "Deteniendo backend..."
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -ErrorAction SilentlyContinue
}
exit $ExitCode
