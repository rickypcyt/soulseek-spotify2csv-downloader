"""Spotify OAuth orchestration run in a background thread."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

from backend.spotify_to_csv import LocalSpotifyOAuth

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


class SpotifyAuthManager:
    """Manages the Spotify OAuth flow and cached token state."""

    def __init__(self, state: RuntimeState) -> None:
        self.state = state
        self.auth_state: dict[str, object] = {"status": "not_configured", "error": None}
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def _oauth(self) -> LocalSpotifyOAuth:
        config = self.state.config_store.get()
        client_id = config.get("spotify_client_id", "")
        client_secret = self.state.config_store.get_secret("spotify_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Configura primero Spotify Client ID y Client Secret en Settings.")
        return LocalSpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=config.get("spotify_redirect_uri", "http://127.0.0.1:8080/callback"),
            scope="playlist-read-private playlist-read-collaborative",
            open_browser=True,
        )

    def _worker(self, auth: LocalSpotifyOAuth) -> None:
        try:
            auth.get_access_token(as_dict=True)
            self.auth_state = {"status": "authenticated", "error": None}
            self.state.logs.add("[spotify] Autorización completada desde Settings")
        except Exception as exc:
            self.auth_state = {"status": "error", "error": str(exc)}
            self.state.logs.add(f"[spotify] Error de autorización: {exc}")

    def status(self) -> dict[str, object]:
        config = self.state.config_store.get()
        if not config.get("spotify_client_id") or not self.state.config_store.get_secret("spotify_client_secret"):
            return {"status": "not_configured"}
        if self.auth_state.get("status") == "authenticating":
            return dict(self.auth_state)
        try:
            auth = self._oauth()
            token = auth.cache_handler.get_cached_token()
            authenticated = bool(token and auth.validate_token(token))
            status = "authenticated" if authenticated else "not_authenticated"
            self.auth_state = {"status": status, "error": None}
            return dict(self.auth_state)
        except Exception as exc:
            return {"status": "error", "error": str(exc)}

    def start(self) -> tuple[dict[str, object], int]:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return dict(self.auth_state), 202
            try:
                auth = self._oauth()
            except Exception as exc:
                return {"status": "not_configured", "error": str(exc)}, 400
            auth_url = auth.get_authorize_url()
            self.auth_state = {"status": "authenticating", "url": auth_url, "error": None}
            self._thread = threading.Thread(target=self._worker, args=(auth,), daemon=True)
            self._thread.start()
        return dict(self.auth_state), 202

    def search_tracks(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        config = self.state.config_store.get()
        client_id = config.get("spotify_client_id", "")
        client_secret = self.state.config_store.get_secret("spotify_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Configura Spotify Client ID y Client Secret en Settings.")
        auth = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
        spotify = spotipy.Spotify(auth_manager=auth)
        items = spotify.search(q=query, type="track", limit=limit).get("tracks", {}).get("items", [])
        tracks: list[dict[str, str]] = []
        for track in items:
            album = track.get("album") or {}
            artists = " ".join(artist.get("name", "") for artist in track.get("artists", []))
            images = album.get("images") or []
            tracks.append({
                "track_name": str(track.get("name") or ""),
                "artists": artists,
                "album": str(album.get("name") or ""),
                "duration_ms": str(track.get("duration_ms") or ""),
                "spotify_url": str((track.get("external_urls") or {}).get("spotify") or ""),
                "spotify_preview": str(track.get("preview_url") or ""),
                "search_query": f"{artists} {track.get('name', '')}".strip(),
                "cover_url": str(images[0].get("url") if images else ""),
            })
        return tracks

    def search_track_metadata(self, query: str) -> dict[str, str]:
        config = self.state.config_store.get()
        client_id = config.get("spotify_client_id", "")
        client_secret = self.state.config_store.get_secret("spotify_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Configura Spotify Client ID y Client Secret en Settings.")
        auth = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
        spotify = spotipy.Spotify(auth_manager=auth)
        results = spotify.search(q=query, type="track", limit=1).get("tracks", {}).get("items", [])
        if not results:
            raise RuntimeError("No se encontró el track en Spotify.")
        track = results[0]
        images = (track.get("album") or {}).get("images") or []
        return {
            "track_key": str(track.get("id") or ""),
            "track_name": str(track.get("name") or ""),
            "artists": " ".join(artist.get("name", "") for artist in track.get("artists", [])),
            "album": str((track.get("album") or {}).get("name") or ""),
            "cover_url": str(images[0].get("url") if images else ""),
        }

    def get_track_metadata(self, track_key: str) -> dict[str, str]:
        if not track_key or len(track_key) != 22 or ":" in track_key:
            raise RuntimeError("track_key no es un ID de Spotify")
        config = self.state.config_store.get()
        client_id = config.get("spotify_client_id", "")
        client_secret = self.state.config_store.get_secret("spotify_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Configura Spotify Client ID y Client Secret en Settings.")
        auth = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
        spotify = spotipy.Spotify(auth_manager=auth)
        track = spotify.track(track_key)
        album = track.get("album") or {}
        images = album.get("images") or []
        artists = " ".join(artist.get("name", "") for artist in track.get("artists", []))
        return {
            "track_key": str(track.get("id") or ""),
            "track_name": str(track.get("name") or ""),
            "artists": artists,
            "album": str(album.get("name") or ""),
            "cover_url": str(images[0].get("url") if images else ""),
        }

    def search_bpm(self, track_key: str, track_name: str, artists: str) -> float:
        config = self.state.config_store.get()
        client_id = config.get("spotify_client_id", "")
        client_secret = self.state.config_store.get_secret("spotify_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Configura Spotify Client ID y Client Secret en Settings.")
        auth = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
        spotify = spotipy.Spotify(auth_manager=auth)
        features = spotify.audio_features([track_key])[0]
        if features and features.get("tempo"):
            return round(float(features["tempo"]), 2)
        query = f"track:{track_name} artist:{artists}".strip()
        results = spotify.search(q=query, type="track", limit=1).get("tracks", {}).get("items", [])
        if not results:
            raise RuntimeError("No se encontró el track en Spotify para obtener el BPM.")
        spotify_id = results[0].get("id")
        fallback = spotify.audio_features([spotify_id])[0] if spotify_id else None
        if not fallback or not fallback.get("tempo"):
            raise RuntimeError("Spotify no proporcionó el BPM de este track.")
        return round(float(fallback["tempo"]), 2)

    def search_cover(self, track_name: str, artists: str) -> str:
        config = self.state.config_store.get()
        client_id = config.get("spotify_client_id", "")
        client_secret = self.state.config_store.get_secret("spotify_client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Configura Spotify Client ID y Client Secret en Settings.")
        auth = SpotifyClientCredentials(client_id=client_id, client_secret=client_secret)
        spotify = spotipy.Spotify(auth_manager=auth)
        query = f"track:{track_name} artist:{artists}".strip()
        results = spotify.search(q=query, type="track", limit=1).get("tracks", {}).get("items", [])
        if not results:
            raise RuntimeError("No se encontró una portada coincidente en Spotify.")
        images = (results[0].get("album") or {}).get("images") or []
        if not images or not images[0].get("url"):
            raise RuntimeError("El track encontrado no tiene portada en Spotify.")
        return images[0]["url"]

    def playlists(self) -> tuple[list[dict[str, str]], str | None]:
        """Return (playlists, error_message)."""
        try:
            auth = self._oauth()
            token = auth.cache_handler.get_cached_token()
            if not token:
                return [], "Conecta Spotify desde Settings primero."
            spotify = spotipy.Spotify(auth_manager=auth)
            current_user = spotify.current_user()
            owner_id = current_user.get("id")
            playlists: list[dict[str, str]] = []
            response = spotify.current_user_playlists(limit=50)
            while response and len(playlists) < 500:
                for playlist in response.get("items", []):
                    if not playlist or not playlist.get("id"):
                        continue
                    playlist_owner = (playlist.get("owner") or {}).get("id")
                    if owner_id and playlist_owner != owner_id:
                        continue
                    playlists.append({
                        "id": playlist["id"],
                        "name": playlist.get("name") or "Sin nombre",
                        "url": playlist.get("external_urls", {}).get(
                            "spotify",
                            f"https://open.spotify.com/playlist/{playlist['id']}",
                        ),
                    })
                if not response.get("next"):
                    break
                response = spotify.next(response)
            playlists.sort(key=lambda playlist: playlist["name"].casefold())
            return playlists, None
        except Exception as exc:
            self.state.logs.add(f"[spotify] Error al cargar playlists: {exc}")
            return [], str(exc)
