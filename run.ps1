[CmdletBinding()]
param()

$EnvFile = if (Test-Path "$PSScriptRoot\.env.local") {
    "$PSScriptRoot\.env.local"
} else {
    "$PSScriptRoot\.env"
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

$PreviewsDir = "$PSScriptRoot\previews"
$IncompleteDir = "$PSScriptRoot\previews\.incomplete"
New-Item -ItemType Directory -Path $PreviewsDir -Force | Out-Null
New-Item -ItemType Directory -Path $IncompleteDir -Force | Out-Null

if (Test-Path "$PSScriptRoot\spotify-soulseek-web") {
    Write-Host "Build React..."
    Push-Location "$PSScriptRoot\spotify-soulseek-web"
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
py -3.13 "$PSScriptRoot\spotify_web.py"
exit $LASTEXITCODE
