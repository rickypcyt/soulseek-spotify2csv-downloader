"""Download, cancel and CSV/txt export endpoints."""

from __future__ import annotations

import csv
import os
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from flask import Blueprint, abort, jsonify, request, send_file

from backend.database import register_download
from backend.soundcloud_service import SoundCloudServiceError, download_soundcloud
from backend.youtube_service import YouTubeServiceError, download_youtube_audio

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("download", __name__)

    @bp.route("/api/download", methods=["POST"])
    def api_download():
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        filename = data.get("filename", "").strip()
        size = data.get("size", 0)
        folder_name = str(data.get("folder_name", "")).strip()
        playlist_key = str(data.get("playlist_key", "")).strip()
        track_key = str(data.get("track_key", "")).strip()
        track_name = str(data.get("track_name", "")).strip()
        artists = str(data.get("artists", "")).strip()
        cover_url = str(data.get("cover_url", "")).strip()
        if not username or not filename:
            return jsonify({"error": "falta username o filename"}), 400
        download_id = str(uuid.uuid4())
        body, status = state.slskd.enqueue_transfer(username, filename, size, label="download")
        if status == 200 and body.get("ok"):
            download_key = (username, filename)
            register_download(download_id, playlist_key, track_key, username, filename, size)
            state.slskd.pending_folders[download_key] = folder_name
            state.slskd.pending_metadata[download_key] = {
                "download_id": download_id,
                "playlist_key": playlist_key,
                "track_key": track_key,
                "track_name": track_name,
                "artists": artists,
                "cover_url": cover_url,
            }
        return jsonify(body), status

    @bp.route("/api/download/status")
    def api_download_status():
        username = request.args.get("username", "").strip()
        filename = request.args.get("filename", "").strip()
        requested_folder = request.args.get("folder_name", "").strip()
        if not username or not filename:
            return jsonify({"state": "missing"}), 200
        try:
            return jsonify(
                state.slskd.download_status(
                    username, filename, requested_folder, state.library.playlist_name()
                )
            )
        except Exception as e:
            state.logs.add(f"[slskd] download status error: {e}")
            return jsonify({"state": "error"}), 200

    @bp.route("/api/cancel", methods=["POST"])
    def api_cancel():
        data = request.get_json() or {}
        username = data.get("username", "").strip()
        filename = data.get("filename", "").strip()
        if not username or not filename:
            return jsonify({"error": "falta username o filename"}), 400
        body, status = state.slskd.cancel_transfer(username, filename)
        return jsonify(body), status

    @bp.route("/api/download/csv")
    def api_download_csv():
        csv_path = str(state.settings.csv_output)
        if not os.path.exists(csv_path):
            abort(404)
        return send_file(csv_path, as_attachment=True, download_name="spotify_output.csv")

    @bp.route("/api/download/soulseek")
    def api_download_soulseek():
        csv_path = str(state.settings.csv_output)
        if not os.path.exists(csv_path):
            abort(404)
        txt_path = os.path.join(str(state.settings.script_dir), "web_soulseek_searches.txt")
        with open(csv_path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        with open(txt_path, "w", encoding="utf-8") as f:
            f.writelines(row["search_query"] + "\n" for row in rows)
        return send_file(txt_path, as_attachment=True, download_name="soulseek_searches.txt")

    @bp.route("/api/youtube/download", methods=["POST"])
    def api_youtube_download():
        data = request.get_json() or {}
        url = str(data.get("url", "")).strip()
        if not url:
            return jsonify({"error": "falta url"}), 400
        try:
            output_path = download_youtube_audio(
                url,
                Path(state.previews_dir),
                audio_format="flac",
            )
            rel = os.path.relpath(str(output_path), state.previews_dir).replace("\\", "/")
            return jsonify({"ok": True, "file": str(output_path), "rel": rel})
        except YouTubeServiceError as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    @bp.route("/api/soundcloud/download", methods=["POST"])
    def api_soundcloud_download():
        data = request.get_json() or {}
        url = str(data.get("url", "")).strip()
        if not url:
            return jsonify({"error": "falta url"}), 400
        try:
            output = download_soundcloud(url, Path(state.previews_dir))
            rel = (
                os.path.relpath(output, state.previews_dir).replace("\\", "/")
                if os.path.isfile(output)
                else None
            )
            return jsonify({"ok": True, "file": output, "rel": rel})
        except SoundCloudServiceError as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    return bp
