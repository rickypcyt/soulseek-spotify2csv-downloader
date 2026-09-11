"""Download, cancel and CSV/txt export endpoints."""

from __future__ import annotations

import csv
import os
from typing import TYPE_CHECKING

from flask import Blueprint, abort, jsonify, request, send_file

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
        track_key = str(data.get("track_key", "")).strip()
        track_name = str(data.get("track_name", "")).strip()
        artists = str(data.get("artists", "")).strip()
        if not username or not filename:
            return jsonify({"error": "falta username o filename"}), 400
        body, status = state.slskd.enqueue_transfer(username, filename, size, label="download")
        if status == 200 and body.get("ok"):
            download_key = (username, filename)
            state.slskd.pending_folders[download_key] = folder_name
            state.slskd.pending_metadata[download_key] = {
                "track_key": track_key,
                "track_name": track_name,
                "artists": artists,
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

    return bp
