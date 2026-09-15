import csv
from pathlib import Path

from backend.spotify_to_csv import convert


class SpotifyServiceError(RuntimeError):
    """Raised when the Spotify conversion process fails."""


def run_conversion(
    run_script: Path,
    url: str,
    output: Path,
    environment: dict[str, str] | None = None,
) -> Path:
    try:
        convert(url, str(output), environment)
    except RuntimeError as exc:
        raise SpotifyServiceError(str(exc)) from exc
    except Exception as exc:
        raise SpotifyServiceError(str(exc)) from exc
    return output


def read_tracks(csv_path: str | Path) -> list[dict[str, str]]:
    with Path(csv_path).open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))
