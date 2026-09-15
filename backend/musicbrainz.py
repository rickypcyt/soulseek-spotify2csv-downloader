import time
import urllib.parse
from typing import Any

import requests

_USER_AGENT = "soulseek-app/1.0 (devin@soulseek.local)"
_LAST_CALL = 0.0


def _rate_limit(min_delay: float = 1.1) -> None:
    global _LAST_CALL
    now = time.time()
    elapsed = now - _LAST_CALL
    if elapsed < min_delay:
        time.sleep(min_delay - elapsed)
    _LAST_CALL = time.time()


def _join_artist_credit(artist_credit: list[dict[str, Any]]) -> str:
    parts = []
    for ac in artist_credit:
        parts.append(ac.get("name", ""))
        parts.append(ac.get("joinphrase", ""))
    return "".join(parts).strip()


def _cover_url(release_id: str) -> str:
    return f"https://coverartarchive.org/release/{release_id}/front"


def _recording_to_metadata(recording: dict[str, Any]) -> dict[str, str]:
    title = str(recording.get("title", "")).strip()
    artist_credit = recording.get("artist-credit") or []
    artists = _join_artist_credit(artist_credit)
    releases = recording.get("releases") or []
    album = ""
    release_id = ""
    if releases:
        album = str(releases[0].get("title", "")).strip()
        release_id = str(releases[0].get("id", "")).strip()
    cover_url = _cover_url(release_id) if release_id else ""
    return {
        "track_key": f"mbid:{recording.get('id', '')}",
        "track_name": title,
        "artists": artists,
        "album": album,
        "cover_url": cover_url,
    }


def _search_recordings(query: str, limit: int = 1) -> list[dict[str, Any]]:
    _rate_limit()
    url = "https://musicbrainz.org/ws/2/recording/"
    params = {
        "query": query,
        "fmt": "json",
        "limit": limit,
    }
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
    response = requests.get(url, params=params, headers=headers, timeout=20)
    response.raise_for_status()
    return response.json().get("recordings", [])


def search_track_metadata(query: str) -> dict[str, str]:
    recordings = _search_recordings(query, limit=1)
    if not recordings:
        raise RuntimeError("No se encontró el track en MusicBrainz.")
    return _recording_to_metadata(recordings[0])


def search_cover(track_name: str, artists: str) -> str:
    query = f"artist:{artists} AND recording:{track_name}".strip()
    recordings = _search_recordings(query, limit=1)
    if not recordings:
        raise RuntimeError("No se encontró una portada en MusicBrainz.")
    metadata = _recording_to_metadata(recordings[0])
    if not metadata.get("cover_url"):
        raise RuntimeError("MusicBrainz no tiene portada para este track.")
    return metadata["cover_url"]
