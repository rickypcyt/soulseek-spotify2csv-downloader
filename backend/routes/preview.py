"""Preview endpoints: Spotify/text loading, slskd preview transfers and saving."""

from __future__ import annotations

import os
import uuid
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from flask import Blueprint, abort, jsonify, request, send_file

import requests

from backend.database import set_playlist_track_status
from backend.fs_utils import move_file_with_retry, remove_file_with_retry, safe_dirname, safe_join
from backend.spotify_service import read_tracks, run_conversion
from backend.spotify_to_csv import parse_spotify_id

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("preview", __name__)

    def _fetch_csv(url: str) -> str:
        state.logs.add(f"[spotify] Descargando: {url}")
        runtime_config = state.config_store.get()
        environment = os.environ.copy()
        environment.update(
            {
                "SPOTIPY_CLIENT_ID": runtime_config.get("spotify_client_id", ""),
                "SPOTIPY_CLIENT_SECRET": state.config_store.get_secret("spotify_client_secret"),
                "SPOTIPY_REDIRECT_URI": runtime_config.get("spotify_redirect_uri", ""),
            }
        )
        output = run_conversion(state.settings.run_script, url, str(state.settings.csv_output), environment=environment)
        state.logs.add("[spotify] Descarga finalizada")
        return output

    @bp.route("/api/preview", methods=["POST"])
    def api_preview():
        data = request.get_json() or {}
        url = data.get("url", "").strip()
        provider = str(data.get("provider", "spotify")).strip().lower()
        if provider not in {"spotify", "soulseek"}:
            provider = "spotify"
        if not url:
            state.logs.add("[web] Error: falta URL o texto")
            return jsonify({"error": "Pegá un link de Spotify o texto para buscar en Soulseek."}), 400
        try:
            try:
                parse_spotify_id(url)
                is_spotify_link = True
            except ValueError:
                is_spotify_link = False

            if not is_spotify_link:
                tracks = []
                if provider == "spotify":
                    try:
                        tracks = state.spotify_auth.search_tracks(url)
                    except Exception as spotify_error:
                        state.logs.add(f"[spotify] búsqueda libre no disponible: {spotify_error}")
                if provider == "spotify" and tracks:
                    state.logs.add(f"[web] búsqueda libre en Spotify: {url} · {len(tracks)} resultado(s)")
                    return jsonify({"tracks": tracks, "playlist_name": f"Resultados Spotify · {url}", "source": "spotify_search"})
                tracks = [{
                    "track_name": url,
                    "artists": "",
                    "album": "",
                    "duration_ms": "",
                    "spotify_url": "",
                    "spotify_preview": "",
                    "search_query": url,
                    "cover_url": "",
                }]
                state.logs.add(f"[web] búsqueda de texto directo: {url}")
                return jsonify({"tracks": tracks, "playlist_name": "Búsqueda Soulseek", "source": "soulseek"})

            _fetch_csv(url)
            tracks = read_tracks(state.settings.csv_output)
            state.logs.add(f"[web] {len(tracks)} pista(s) cargadas")
            return jsonify({"tracks": tracks, "playlist_name": state.library.playlist_name(), "source": "spotify"})
        except Exception as e:
            state.logs.add(f"[web] Error: {e}")
            return jsonify({"error": str(e)}), 500

    @bp.route("/api/spotify/preview/download", methods=["POST"])
    def api_spotify_preview_download():
        data = request.get_json() or {}
        preview_url = str(data.get("preview_url", "")).strip()
        parsed = urlparse(preview_url)
        hostname = (parsed.hostname or "").lower()
        allowed_host = (
            hostname == "scdn.co" or hostname.endswith(".scdn.co")
            or hostname == "spotifycdn.com" or hostname.endswith(".spotifycdn.com")
        )
        if parsed.scheme != "https" or not allowed_host:
            return jsonify({"error": "URL de preview de Spotify inválida"}), 400
        destination = os.path.join(state.previews_dir, f"spotify-preview-{uuid.uuid4().hex}.mp3")
        try:
            os.makedirs(state.previews_dir, exist_ok=True)
            with requests.get(preview_url, stream=True, timeout=30) as response:
                response.raise_for_status()
                with open(destination, "wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 256):
                        if chunk:
                            output.write(chunk)
            return jsonify({"ok": True, "path": os.path.basename(destination)})
        except Exception as exc:
            try:
                os.remove(destination)
            except OSError:
                pass
            state.logs.add(f"[spotify] error descargando preview: {exc}")
            return jsonify({"error": "No se pudo descargar el preview de Spotify"}), 502

    @bp.route("/api/preview_audio", methods=["POST"])
    def api_preview_audio():
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        filename = data.get("filename", "").strip()
        size = data.get("size", 0)
        if not username or not filename:
            return jsonify({"error": "falta username o filename"}), 400
        body, status = state.slskd.enqueue_transfer(username, filename, size, label="preview")
        return jsonify(body), status

    @bp.route("/api/preview/status")
    def api_preview_status():
        username = request.args.get("username", "").strip()
        filename = request.args.get("filename", "").strip()
        if not username or not filename:
            return jsonify({"state": "missing"}), 200
        try:
            return jsonify(state.slskd.preview_status(username, filename))
        except Exception as e:
            state.logs.add(f"[slskd] preview status error: {e}")
            return jsonify({"state": "error"}), 200

    @bp.route("/api/preview/stream")
    def api_preview_stream():
        rel = request.args.get("path", "").strip()
        if not rel:
            abort(400)
        try:
            full = safe_join(state.previews_dir, rel)
        except ValueError:
            abort(403)
        if not os.path.exists(full):
            abort(404)
        return send_file(
            full,
            mimetype="audio/mpeg",
            conditional=True,
            as_attachment=False,
        )

    @bp.route("/api/preview/save", methods=["POST"])
    def api_save_preview():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip()
        folder_name = str(data.get("folder_name", "")).strip() or state.library.playlist_name()
        playlist_key = str(data.get("playlist_key", "")).strip()
        track_key = str(data.get("track_key", "")).strip()
        track_name = str(data.get("track_name", "")).strip()
        artists = str(data.get("artists", "")).strip()
        cover_url = str(data.get("cover_url", "")).strip()
        if not rel:
            return jsonify({"error": "Falta el archivo de preview"}), 400
        try:
            source = safe_join(state.previews_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(source):
            return jsonify({"error": "El preview ya no existe"}), 404

        target_dir = os.path.join(state.current_downloads_dir, safe_dirname(folder_name))
        os.makedirs(target_dir, exist_ok=True)
        destination = os.path.join(target_dir, os.path.basename(source))
        try:
            if os.path.abspath(source) != os.path.abspath(destination):
                if os.path.exists(destination):
                    remove_file_with_retry(source)
                else:
                    move_file_with_retry(source, destination)
            saved_path = os.path.relpath(destination, state.current_downloads_dir).replace("\\", "/")
            state.library.register_track(track_key, track_name, artists, saved_path, cover_url)
            if playlist_key and track_key:
                set_playlist_track_status(playlist_key, track_key, downloaded=True)
            state.logs.add(f"[library] preview guardado en {saved_path}")
            return jsonify({"ok": True, "path": saved_path, "folder": safe_dirname(folder_name)})
        except Exception as exc:
            state.logs.add(f"[library] error al guardar preview: {exc}")
            return jsonify({"error": str(exc)}), 500

    return bp
