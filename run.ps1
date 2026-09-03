[CmdletBinding()]
param(
    [Parameter(HelpMessage = "URL de Spotify")]
    [string]$Url = "https://open.spotify.com/playlist/54iAM3BwNnZkqRlo7fKDr0",

    [Parameter(HelpMessage = "Archivo CSV de salida")]
    [string]$Output = "spotify_output.csv",

    [Parameter(HelpMessage = "Client ID de Spotify")]
    [string]$ClientId = "f1f3db4de9c7436c9c693dc2c1202955"
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

if (-not $env:SPOTIPY_CLIENT_SECRET) {
    $secure = Read-Host -AsSecureString "Spotify Client Secret"
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $env:SPOTIPY_CLIENT_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

# Ejecutar con Python 3.13 (donde esta instalado spotipy)
py -3.13 "$PSScriptRoot\spotify_to_csv.py" "$Url" -o "$Output"
