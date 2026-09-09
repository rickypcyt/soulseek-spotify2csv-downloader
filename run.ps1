[CmdletBinding()]
param()

$Root = $PSScriptRoot
$EnvFile = if (Test-Path (Join-Path $Root ".env.local")) {
    Join-Path $Root ".env.local"
} else {
    Join-Path $Root ".env"
}

# Variables de entorno opcionales para migración y compatibilidad.
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match "^([A-Z0-9_]+)=(.*)$") {
            $name = $matches[1]
            $value = $matches[2]
            if ($value -match '^["\x27](.*)["\x27]$') {
                $value = $matches[1]
            }
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
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
