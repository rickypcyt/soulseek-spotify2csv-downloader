"""Storage endpoints backed by SQLite (replaces localStorage)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from flask import Blueprint, jsonify, request

from backend.database import (
    clear_url_history,
    get_output_folder_pref,
    load_last_playlist,
    load_search_cache,
    load_search_prefs,
    load_url_history,
    save_last_playlist,
    save_search_cache,
    save_search_prefs,
    save_url_history,
    set_output_folder_pref,
)

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("storage", __name__)

    # ---- last playlist ----
    @bp.route("/api/storage/playlist", methods=["GET", "PUT"])
    def api_last_playlist():
        if request.method == "GET":
            return jsonify(load_last_playlist())
        data = request.get_json() or {}
        save_last_playlist(data)
        return jsonify({"ok": True})

    # ---- url history ----
    @bp.route("/api/storage/history", methods=["GET", "PUT", "DELETE"])
    def api_url_history():
        if request.method == "GET":
            return jsonify(load_url_history())
        if request.method == "DELETE":
            clear_url_history()
            return jsonify({"ok": True})
        data = request.get_json() or {}
        entries = data.get("entries", [])
        save_url_history(entries)
        return jsonify({"ok": True})

    # ---- search cache ----
    @bp.route("/api/storage/search-cache", methods=["GET", "PUT"])
    def api_search_cache():
        playlist_url = request.args.get("playlist_url") if request.method == "GET" else None
        if request.method == "GET":
            if not playlist_url:
                return jsonify({"searches": []})
            return jsonify({"searches": load_search_cache(playlist_url)})
        data = request.get_json() or {}
        playlist_url = data.get("playlist_url", "")
        searches = data.get("searches", [])
        if not playlist_url:
            return jsonify({"error": "Falta playlist_url"}), 400
        save_search_cache(playlist_url, searches)
        return jsonify({"ok": True})

    # ---- output folder preferences ----
    @bp.route("/api/storage/output-folder", methods=["GET", "PUT"])
    def api_output_folder():
        playlist_url = request.args.get("playlist_url") if request.method == "GET" else None
        if request.method == "GET":
            if not playlist_url:
                return jsonify({"folderName": None})
            return jsonify({"folderName": get_output_folder_pref(playlist_url)})
        data = request.get_json() or {}
        playlist_url = data.get("playlist_url", "")
        folder_name = data.get("folder_name", "")
        if not playlist_url:
            return jsonify({"error": "Falta playlist_url"}), 400
        set_output_folder_pref(playlist_url, folder_name)
        return jsonify({"ok": True})

    # ---- search preferences ----
    @bp.route("/api/storage/search-preferences", methods=["GET", "PUT"])
    def api_search_prefs():
        if request.method == "GET":
            return jsonify(load_search_prefs())
        data = request.get_json() or {}
        pick_mode = data.get("pickMode", "quality")
        format_pref = data.get("formatPref", "any")
        save_search_prefs(pick_mode, format_pref)
        return jsonify({"ok": True})

    return bp
