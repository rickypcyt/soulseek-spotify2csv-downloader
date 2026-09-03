[CmdletBinding()]
param(
    [string]$Csv = "spotify_output.csv",
    [string]$Output = "soulseek_searches.txt"
)

if (-not (Test-Path $Csv)) {
    Write-Host "No se encontró $Csv. Corré primero .\run.ps1" -ForegroundColor Red
    exit 1
}

Import-Csv $Csv |
    Select-Object -ExpandProperty search_query |
    Set-Content -Path $Output -Encoding UTF8

$count = (Get-Content $Output).Count
Write-Host "Generado $Output con $count búsquedas."
