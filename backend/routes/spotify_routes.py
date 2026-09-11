"""Spotify auth, playlists and per-track playlist status endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from flask import Blueprint, jsonify, request

from backend.database import get_playlist_track_statuses, set_playlist_track_status

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("spotify", __name__)

    @bp.route("/api/spotify/auth/status")
    def api_spotify_auth_status():
        return jsonify(state.spotify_auth.status())

    @bp.route("/api/spotify/auth/start", methods=["POST"])
    def api_spotify_auth_start():
        body, status = state.spotify_auth.start()
        return jsonify(body), status

    @bp.route("/api/spotify/playlists")
    def api_spotify_playlists():
        playlists, error = state.spotify_auth.playlists()
        if error is not None:
            return jsonify({"error": error}), 500
        return jsonify({"playlists": playlists})

    @bp.route("/api/playlist/status", methods=["GET", "POST"])
    def api_playlist_status():
        if request.method == "GET":
            playlist_key = request.args.get("playlist_key", "").strip()
            if not playlist_key:
                return jsonify({"error": "Falta playlist_key"}), 400
            return jsonify({"statuses": get_playlist_track_statuses(playlist_key)})

        data = request.get_json() or {}
        playlist_key = str(data.get("playlist_key", "")).strip()
        track_key = str(data.get("track_key", "")).strip()
        downloaded = data.get("downloaded")
        if not playlist_key or not track_key or not isinstance(downloaded, bool):
            return jsonify({"error": "playlist_key, track_key y downloaded son obligatorios"}), 400
        try:
            set_playlist_track_status(playlist_key, track_key, downloaded)
            return jsonify({"ok": True, "playlist_key": playlist_key, "track_key": track_key, "downloaded": downloaded})
        except Exception as exc:
            state.logs.add(f"[playlist] Error al guardar estado: {exc}")
            return jsonify({"error": str(exc)}), 500

    return bp
