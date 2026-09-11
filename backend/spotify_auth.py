"""Spotify OAuth orchestration run in a background thread."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

import spotipy

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

    def _worker(self) -> None:
        try:
            auth = self._oauth()
            self.auth_state = {"status": "authenticating", "error": None}
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
                return {"status": "authenticating"}, 202
            try:
                self._oauth()
            except Exception as exc:
                return {"status": "not_configured", "error": str(exc)}, 400
            self.auth_state = {"status": "authenticating", "error": None}
            self._thread = threading.Thread(target=self._worker, daemon=True)
            self._thread.start()
        return {"status": "authenticating"}, 202

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
