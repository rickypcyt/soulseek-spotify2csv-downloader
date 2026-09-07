[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Vendor = Join-Path $Root "vendor"
$Cache = Join-Path $Root ".setup-cache"
$ConfigPath = Join-Path $Root "web_config.json"

$SlskdVersion = "0.26.0"
$SlskdArchive = "slskd-$SlskdVersion-win-x64.zip"
$SlskdUrl = "https://github.com/slskd/slskd/releases/download/$SlskdVersion/$SlskdArchive"

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "No se encontró '$Name'. Instálalo antes de continuar."
    }
}

function Get-Archive([string]$Url, [string]$Destination) {
    Write-Host "Descargando $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Install-Binary([string]$Name, [string]$Url, [string]$Executable, [string]$ExpectedSha256 = "") {
    $target = Join-Path $Vendor $Name
    $existing = Get-ChildItem -Path $target -Filter $Executable -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and -not $Force) {
        Write-Host "$Name ya está instalado en $($existing.FullName)"
        return $existing.FullName
    }

    New-Item -ItemType Directory -Path $Cache -Force | Out-Null
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $archive = Join-Path $Cache (Split-Path $Url -Leaf)
    if ($Force -or -not (Test-Path $archive)) {
        Get-Archive $Url $archive
    }
    if ($ExpectedSha256) {
        $actualSha256 = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
            throw "Checksum inválido para $Name."
        }
    }
    if ($Force -and (Test-Path $target)) {
        Get-ChildItem $target -Force | Remove-Item -Recurse -Force
    }
    Expand-Archive -Path $archive -DestinationPath $target -Force
    $installed = Get-ChildItem -Path $target -Filter $Executable -Recurse -File | Select-Object -First 1
    if (-not $installed) {
        throw "El archivo descargado de $Name no contiene $Executable."
    }
    return $installed.FullName
}

Assert-Command "py"
Assert-Command "npm"

Write-Host "Instalando dependencias de Python..."
py -3.13 -m pip install -r (Join-Path $Root "requirements.txt")

Write-Host "Instalando dependencias del frontend..."
Push-Location (Join-Path $Root "spotify-soulseek-web")
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Falló npm install." }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $Vendor -Force | Out-Null
$slskdPath = Install-Binary "slskd" $SlskdUrl "slskd.exe"

$config = [ordered]@{}
if (Test-Path $ConfigPath) {
    try {
        $existingConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        foreach ($property in $existingConfig.PSObject.Properties) {
            $config[$property.Name] = $property.Value
        }
    } catch {
        $config = [ordered]@{}
    }
}
$config["provider"] = "slskd"
$config["slskd_path"] = $slskdPath
$config | ConvertTo-Json -Depth 5 | Set-Content -Path $ConfigPath -Encoding UTF8

Write-Host ""
Write-Host "Herramientas instaladas correctamente."
Write-Host "slskd: $slskdPath"
Write-Host "Proveedor: slskd"
Write-Host "Ahora ejecuta .\run.ps1 y configura Spotify desde la interfaz."
