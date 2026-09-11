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

if (Test-Path (Join-Path $Root "frontend")) {
    Write-Host "Build React..."
    Push-Location (Join-Path $Root "frontend")
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Falló el build del frontend (exit code $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }
}

# La configuración de Spotify y Soulseek se introduce desde la interfaz web.
Push-Location $Root
try {
    py -3.13 -m backend.spotify_web
    $ExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $ExitCode
