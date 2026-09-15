[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Yes,       # omite la confirmación antes de instalar dependencias
    [switch]$SkipBuild  # ejecuta desde fuente sin compilar ni empaquetar
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$FrontendDir = Join-Path $Root "frontend"
$ExePath = Join-Path $Root "dist\spotify2soulseek.exe"
$RequirementsPath = Join-Path $Root "config\requirements.txt"
$SpecPath = Join-Path $Root "packaging\soulseek.spec"

foreach ($f in @($RequirementsPath, $SpecPath)) {
    if (-not (Test-Path $f)) { throw "No se encontró $f." }
}

$RequiredPythonId = "Python.Python.3.13"
$RequiredNodeId   = "OpenJS.NodeJS.LTS"

function Assert-Winget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget no está disponible. Instala 'App Installer' desde la Microsoft Store " +
              "(https://apps.microsoft.com/detail/9nblggh4nns1) y vuelve a ejecutar este script."
    }
}

function Update-SessionPath {
    # Tras instalar con winget, el PATH del proceso actual no se entera.
    # Lo reconstruimos combinando Machine + User desde el registro.
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Confirm-Install([string]$Label) {
    if ($Yes) { return $true }
    $answer = Read-Host "¿Instalar $Label automáticamente con winget? (s/N)"
    return $answer -match '^[sS]'
}

function Install-WithWinget([string]$PackageId, [string]$Label) {
    Assert-Winget
    if (-not (Confirm-Install $Label)) {
        throw "$Label es requerido y no se instaló. Instálalo manualmente y vuelve a ejecutar el script."
    }
    Write-Host "Instalando $Label ($PackageId) con winget..."
    winget install --id $PackageId --exact --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget no pudo instalar $Label (código $LASTEXITCODE)."
    }
    Update-SessionPath
}

function Install-Python313 {
    $ok = $false
    try {
        py -3.13 -c "" 2>$null
        $ok = ($LASTEXITCODE -eq 0)
    } catch { $ok = $false }

    if (-not $ok) {
        Install-WithWinget $RequiredPythonId "Python 3.13"
        py -3.13 -c "" 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Python 3.13 sigue sin detectarse tras la instalación. Reinicia la terminal e intenta de nuevo."
        }
    }
}

function Install-Node {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Install-WithWinget $RequiredNodeId "Node.js"
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
            throw "npm sigue sin detectarse tras la instalación. Reinicia la terminal e intenta de nuevo."
        }
    }
}

Install-Python313

$distDir = Join-Path $FrontendDir "dist"
# Con -SkipBuild el frontend solo se compila si no existe un build previo.
$needFrontendBuild = -not $SkipBuild -or -not (Test-Path (Join-Path $distDir "index.html"))
if ($needFrontendBuild) { Install-Node }

$needsPip = $Force
if (-not $needsPip) {
    py -3.13 -c "import flask, requests, spotipy, keyring, mutagen, PyInstaller" 2>$null
    if ($LASTEXITCODE -ne 0) { $needsPip = $true }
}
if ($needsPip) {
    Write-Host "Instalando dependencias de Python..."
    py -3.13 -m pip install -r $RequirementsPath
    if ($LASTEXITCODE -ne 0) { throw "Falló pip install." }
} else {
    Write-Host "Dependencias de Python ya están instaladas."
}

if ($needFrontendBuild) {
    $needsNpm = $Force -or -not (Test-Path (Join-Path $FrontendDir "node_modules"))
    if ($needsNpm) {
        Write-Host "Instalando dependencias del frontend..."
        Push-Location $FrontendDir
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "Falló npm install." }
        } finally {
            Pop-Location
        }
    }

    Write-Host "Compilando frontend..."
    Push-Location $FrontendDir
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Falló el build del frontend." }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $distDir)) {
        throw "No se encontró frontend/dist tras el build."
    }
}

if ($SkipBuild) {
    # Misma base de datos que el exe: los datos viven en dist/data.
    $env:SOULSEEK_DATA_DIR = Join-Path $Root "dist\data"
    Write-Host "Iniciando aplicación desde fuente (sin empaquetar)..."
    Get-Process spotify2soulseek -ErrorAction SilentlyContinue |
        Stop-Process -Force -PassThru |
        Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    Push-Location $Root
    try {
        py -3.13 -m backend.spotify_web
    } finally {
        Pop-Location
    }
    exit $LASTEXITCODE
}

# Reempaquetar si el exe no existe, si se forzó, o si alguna fuente embebida
# (frontend/dist, backend/*.py, el spec) es más nueva que el exe.
$buildInputs = @(
    Get-ChildItem $distDir -Recurse -File
    Get-ChildItem (Join-Path $Root "backend") -Recurse -File -Filter *.py
    Get-Item $SpecPath
)
$sourceNewest = ($buildInputs | Measure-Object LastWriteTime -Maximum).Maximum
$sourceNewer = (Test-Path $ExePath) -and $sourceNewest -and
               ($sourceNewest -gt (Get-Item $ExePath).LastWriteTime)
$needsBuild = $Force -or $sourceNewer -or -not (Test-Path $ExePath)
if ($needsBuild) {
    # Si la app está corriendo, el exe está bloqueado y PyInstaller no puede
    # sobrescribirlo (WinError 5). La cerramos antes de empaquetar.
    Get-Process spotify2soulseek -ErrorAction SilentlyContinue |
        Stop-Process -Force -PassThru |
        Wait-Process -Timeout 10 -ErrorAction SilentlyContinue

    $vendorSlskd = Join-Path $Root "vendor\slskd"
    $slskdExe = Get-ChildItem -Path $vendorSlskd -Filter "slskd.exe" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $slskdExe) {
        Write-Host "Descargando slskd para empaquetar..."
        py -3.13 -c "from backend.bootstrap import download_slskd; download_slskd()"
        if ($LASTEXITCODE -ne 0) { throw "Falló la descarga de slskd." }
        $slskdExe = Get-ChildItem -Path $vendorSlskd -Filter "slskd.exe" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $slskdExe) { throw "No se encontró slskd.exe tras descargar." }
    }
    Write-Host "Empaquetando ejecutable..."
    Push-Location $Root
    try {
        py -3.13 -m PyInstaller $SpecPath --noconfirm
        if ($LASTEXITCODE -ne 0) { throw "Falló PyInstaller." }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $ExePath)) {
    throw "No se encontró $ExePath tras el build."
}

Write-Host "Iniciando aplicación..."
Get-Process spotify2soulseek -ErrorAction SilentlyContinue |
    Stop-Process -Force -PassThru |
    Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
& $ExePath