import csv
import subprocess
from pathlib import Path


class SpotifyServiceError(RuntimeError):
    """Raised when the Spotify conversion process fails."""


def run_conversion(
    run_script: Path,
    url: str,
    output: Path,
    environment: dict[str, str] | None = None,
) -> Path:
    converter_script = Path(run_script).with_name("spotify_to_csv.py")
    command = ["py", "-3.13", str(converter_script), url, "-o", str(output)]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
            env=environment,
        )
    except subprocess.TimeoutExpired as exc:
        raise SpotifyServiceError("La conversión de Spotify superó el límite de 5 minutos.") from exc
    if result.returncode != 0:
        raise SpotifyServiceError(result.stderr or result.stdout or "Error desconocido al convertir Spotify")
    return output


def read_tracks(csv_path: str | Path) -> list[dict[str, str]]:
    with Path(csv_path).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))
