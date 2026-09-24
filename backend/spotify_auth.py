"""Spotify OAuth orchestration with a persistent loopback callback server."""

from __future__ import annotations

import html
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials

from backend.paths import data_dir
from backend.spotify_to_csv import LocalSpotifyOAuth

if TYPE_CHECKING:
    from backend.runtime import RuntimeState

PENDING_AUTH_TIMEOUT_S = 600


def _callback_page(title: str, detail: str) -> bytes:
    return f"""<html>
<script>
window.open('', '_self'); window.close()
</script>
<body>
<h1>{html.escape(title)}</h1>
<p>{html.escape(detail)}</p>
<p>Si esta pestaña no se cierra automáticamente, puedes cerrarla de forma segura.</p>
<button class="closeButton" style="cursor: pointer" onclick="window.close();">
Cerrar ventana
</button>
</body>
</html>""".encode("utf-8")


class _CallbackRequestHandler(BaseHTTPRequestHandler):
    """Receives the Spotify redirect and forwards it to the auth manager."""

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        code = (query.get("code") or [None])[0]
        state = (query.get("state") or [None])[0]
        error = (query.get("error") or [None])[0]
        if code is None and error is None:
            body = _callback_page("Spotify", "Esperando la autorización de Spotify…")
        else:
            body = _callback_page(*self.server.on_spotify_callback(code=code, state=state, error=error))
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


class _CallbackServer(ThreadingHTTPServer):
    """HTTP server on the loopback redirect port, alive for the app's lifetime.

    Unlike spotipy's ephemeral server this keeps listening after (and before)
    each auth flow, so late or duplicated callbacks get a friendly page
    instead of ERR_CONNECTION_REFUSED.
    """

    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port: int, on_spotify_callback) -> None:
        self.on_spotify_callback = on_spotify_callback
        super().__init__(("127.0.0.1", port), _CallbackRequestHandler)


class SpotifyAuthManager:
    """Manages the Spotify OAuth flow and cached token state."""

    def __init__(self, state: RuntimeState) -> None:
        self.state = state
        self.auth_state: dict[str, object] = {"status": "not_configured", "error": None}
        self._pending: LocalSpotifyOAuth | None = None
        self._pending_since: float = 0.0
        self._callback_server: _CallbackServer | None = None
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
            # Cache fijado a data_dir: el default (.cache relativo al CWD)
            # cambia según desde dónde se lance la app y el token "desaparece".
            cache_path=str(data_dir() / "spotify_token.json"),
            open_browser=True,
        )

    def _cached_token_valid(self, auth: LocalSpotifyOAuth) -> bool:
        """Return True when a usable token already exists (refreshing if needed)."""
        token = auth.validate_token(auth.cache_handler.get_cached_token())
        if token is None:
            return False
        if auth.is_token_expired(token):
            token = auth.refresh_access_token(token["refresh_token"])
            auth.cache_handler.save_token_to_cache(token)
        return True

    def _ensure_callback_server(self, redirect_uri: str) -> None:
        port = urlparse(redirect_uri).port
        if not port:
            raise RuntimeError(
                "El redirect URI de Spotify debe incluir un puerto "
                "(p. ej. http://127.0.0.1:8080/callback)."
            )
        if self._callback_server is not None:
            if self._callback_server.server_port == port:
                return
            self._callback_server.shutdown()
            self._callback_server.server_close()
            self._callback_server = None
        self._callback_server = _CallbackServer(port, self._handle_callback)
        threading.Thread(target=self._callback_server.serve_forever, daemon=True).start()

    def _handle_callback(self, code: str | None, state: str | None, error: str | None) -> tuple[str, str]:
        """Called by the callback server when Spotify redirects back."""
        with self._lock:
            auth = self._pending
            if error:
                self._pending = None
                self.auth_state = {"status": "error", "error": error}
                self.state.logs.add(f"[spotify] Error de autorización: {error}")
                return (
                    "Autorización rechazada",
                    f"Spotify devolvió un error: {error}. Volvé a la app e intentá de nuevo.",
                )
            if auth is None or code is None:
                return (
                    "Autorización no disponible",
                    "Esta solicitud ya no está activa. Volvé a la app y presioná "
                    "«conectar Spotify» para generar un link nuevo.",
                )
            if auth.state is not None and state != auth.state:
                return (
                    "Autorización inválida",
                    "Esta respuesta de Spotify no coincide con la solicitud actual. "
                    "Si estás autorizando, completá el proceso en la pestaña que se abrió "
                    "o generá un link nuevo desde la app.",
                )
            try:
                auth.get_access_token(code=code, as_dict=False, check_cache=False)
            except Exception as exc:
                self._pending = None
                self.auth_state = {"status": "error", "error": str(exc)}
                self.state.logs.add(f"[spotify] Error de autorización: {exc}")
                return (
                    "Error de autorización",
                    f"{exc}. Volvé a la app e intentá de nuevo.",
                )
            self._pending = None
            self.auth_state = {"status": "authenticated", "error": None}
            self.state.logs.add("[spotify] Autorización completada desde Settings")
            return (
                "Autorización completada",
                "Spotify quedó conectado. Ya podés volver a la app.",
            )

    def status(self) -> dict[str, object]:
        config = self.state.config_store.get()
        if not config.get("spotify_client_id") or not self.state.config_store.get_secret("spotify_client_secret"):
            return {"status": "not_configured"}
        if self.auth_state.get("status") == "authenticating":
            if self._pending is None or time.monotonic() - self._pending_since > PENDING_AUTH_TIMEOUT_S:
                self._pending = None
                self.auth_state = {"status": "not_authenticated", "error": None}
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

    def start(self, force: bool = False) -> tuple[dict[str, object], int]:
        with self._lock:
            if self._pending is not None:
                return dict(self.auth_state), 202
            try:
                auth = self._oauth()
            except Exception as exc:
                return {"status": "not_configured", "error": str(exc)}, 400
            if not force:
                try:
                    if self._cached_token_valid(auth):
                        self.auth_state = {"status": "authenticated", "error": None}
                        return dict(self.auth_state), 200
                except Exception:
                    pass
            try:
                # El servidor queda escuchando antes de exponer el link o abrir
                # el navegador: Spotify redirige al instante cuando el usuario
                # ya autorizó la app.
                self._ensure_callback_server(auth.redirect_uri)
            except Exception as exc:
                self.auth_state = {"status": "error", "error": f"No se pudo abrir el puerto de callback: {exc}"}
                self.state.logs.add(f"[spotify] {self.auth_state['error']}")
                return dict(self.auth_state), 500
            auth.state = secrets.token_urlsafe(16)
            # Reautorizar muestra la pantalla de Spotify aunque ya haya sesión,
            # para poder cambiar de cuenta en lugar de re-usar el token.
            auth.show_dialog = force
            self._pending = auth
            self._pending_since = time.monotonic()
            auth_url = auth.get_authorize_url()
            self.auth_state = {"status": "authenticating", "url": auth_url, "error": None}
            auth._open_auth_url()
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
