[CmdletBinding()]
param(
    [Parameter(HelpMessage = "URL de Spotify")]
    [string]$Url = "https://open.spotify.com/playlist/54iAM3BwNnZkqRlo7fKDr0",

    [Parameter(HelpMessage = "Archivo CSV de salida")]
    [string]$Output = "spotify_output.csv",

    [Parameter(HelpMessage = "Client ID de Spotify")]
    [string]$ClientId = "f1f3db4de9c7436c9c693dc2c1202955",

    [Parameter(HelpMessage = "Modo de ejecucion: cli o web")]
    [ValidateSet("cli", "web")]
    [string]$Modo = "web",

    [Parameter(HelpMessage = "Ruta al binario de slskr")]
    [string]$SlskrPath = "slskr"
)

$EnvFile = "$PSScriptRoot\.env"

# Cargar credenciales desde un archivo .env si existe
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match "^([A-Z0-9_]+)=(.*)$") {
            $name = $matches[1]
            $value = $matches[2]
            # Sacar comillas si las tiene
            if ($value -match '^["\x27](.*)["\x27]$') {
                $value = $matches[1]
            }
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Forzar el Client ID y el redirect URI correctos
$env:SPOTIPY_CLIENT_ID = $ClientId
$env:SPOTIPY_REDIRECT_URI = "http://127.0.0.1:8080/callback"

# Si se seteo SLSKR_PATH en .env, usarlo para arrancar slskr
if ($env:SLSKR_PATH) {
    $SlskrPath = $env:SLSKR_PATH
}

if (-not $env:SPOTIPY_CLIENT_SECRET) {
    $secure = Read-Host -AsSecureString "Spotify Client Secret"
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $env:SPOTIPY_CLIENT_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

if ($Modo -eq "cli") {
    # Ejecutar con Python 3.13 (donde esta instalado spotipy)
    py -3.13 "$PSScriptRoot\spotify_to_csv.py" "$Url" -o "$Output"

    # Generar el txt con las búsquedas de Soulseek
    & "$PSScriptRoot\preparar_soulseek.ps1" -Csv "$Output" -Output "$($Output -replace '\.csv$', '_soulseek.txt')"
}
else {
    # Matar procesos viejos para evitar conflictos de puerto
    Get-Process slskd -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process slskr -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1

    # Preparar carpeta temporal para previews
    $PreviewsDir = "$PSScriptRoot\previews"
    $IncompleteDir = "$PSScriptRoot\previews\.incomplete"
    if (Test-Path $PreviewsDir) {
        Remove-Item -Recurse -Force $PreviewsDir
    }
    New-Item -ItemType Directory -Path $PreviewsDir -Force | Out-Null
    New-Item -ItemType Directory -Path $IncompleteDir -Force | Out-Null

    # Intentar arrancar slskd o slskr
    if ($env:SLSKD_PATH -and (Test-Path $env:SLSKD_PATH)) {
        if ($env:SLSK_USERNAME) { $env:SLSKD_SLSK_USERNAME = $env:SLSK_USERNAME }
        if ($env:SLSK_PASSWORD) { $env:SLSKD_SLSK_PASSWORD = $env:SLSK_PASSWORD }
        $env:SLSKD__WEB__HTTPS__DISABLED = 'true'
        $env:SLSKD_NO_HTTPS = 'true'
        Write-Host "Arrancando slskd con carpeta de previews: $PreviewsDir"
        Start-Process -FilePath $env:SLSKD_PATH -ArgumentList @("--downloads", $PreviewsDir, "--incomplete", $IncompleteDir) -NoNewWindow
        Start-Sleep -Seconds 5
    }
    elseif ($env:SLSKR_PATH -and (Test-Path $env:SLSKR_PATH)) {
        Write-Host "Arrancando slskr serve..."
        Start-Process -FilePath $env:SLSKR_PATH -ArgumentList "serve" -NoNewWindow
        Start-Sleep -Seconds 3
    }
    else {
        Write-Warning "No se encontro slskd en '$($env:SLSKD_PATH)' ni slskr en '$($env:SLSKR_PATH)'. Setea SLSKD_PATH o SLSKR_PATH en .env"
    }

    # Build del frontend React
    if (Test-Path "$PSScriptRoot\spotify-soulseek-web") {
        Write-Host "Build React..."
        Set-Location "$PSScriptRoot\spotify-soulseek-web"
        npm run build
        Set-Location $PSScriptRoot
    }

    # Correr el servidor en el mismo terminal
    py -3.13 "$PSScriptRoot\spotify_web.py"
}
