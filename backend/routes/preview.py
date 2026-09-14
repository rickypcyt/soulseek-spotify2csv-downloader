"""Preview endpoints: Spotify/text loading, slskd preview transfers and saving."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from flask import Blueprint, abort, jsonify, request, send_file

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
                tracks = [{
                    "track_name": url,
                    "artists": "",
                    "album": "",
                    "duration_ms": "",
                    "spotify_url": "",
                    "spotify_preview": "",
                    "search_query": url,
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
            state.logs.add(f"[library] preview guardado en {saved_path}")
            return jsonify({"ok": True, "path": saved_path, "folder": safe_dirname(folder_name)})
        except Exception as exc:
            state.logs.add(f"[library] error al guardar preview: {exc}")
            return jsonify({"error": str(exc)}), 500

    return bp
