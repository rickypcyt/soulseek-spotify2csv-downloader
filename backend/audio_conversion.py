from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


class AudioConversionError(RuntimeError):
    """Raised when an audio conversion cannot be completed."""


def _ffmpeg_executable() -> str:
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except Exception as exc:
        raise AudioConversionError(
            "No se encontró ffmpeg. Instalalo o reinstalá imageio-ffmpeg."
        ) from exc


def convert_to_flac(source: str | Path) -> Path:
    source_path = Path(source)
    if source_path.suffix.lower() not in {".m4a", ".mp4"}:
        raise AudioConversionError("Solo se pueden convertir archivos M4A o MP4.")
    if not source_path.is_file():
        raise AudioConversionError("El archivo de origen no existe.")

    destination = source_path.with_suffix(".flac")
    if destination.exists():
        raise AudioConversionError(f"Ya existe el archivo FLAC: {destination.name}")

    temporary = destination.with_name(f"{destination.stem}.part.flac")
    command = [
        _ffmpeg_executable(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source_path),
        "-map_metadata",
        "0",
        "-map",
        "0:a:0",
        "-map",
        "0:v?",
        "-c:a",
        "flac",
        "-c:v",
        "copy",
        "-y",
        str(temporary),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=1800, check=False)
    except subprocess.TimeoutExpired as exc:
        temporary.unlink(missing_ok=True)
        raise AudioConversionError("La conversión tardó demasiado.") from exc
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        raise AudioConversionError(result.stderr.strip() or "ffmpeg no pudo convertir el archivo.")

    temporary.replace(destination)
    return destination
