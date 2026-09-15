"""Soulseek search endpoints (slskd-backed)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from flask import Blueprint, jsonify, request

from backend.slskd_client import MAX_SEARCH_QUERY_LENGTH

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("search", __name__)

    @bp.route("/api/search_soulseek", methods=["POST"])
    @bp.route("/api/search_slskr", methods=["POST"])
    def api_search_soulseek():
        data = request.get_json() or {}
        query = str(data.get("query", "")).strip()
        if not query:
            state.logs.add("[search] Error: falta query")
            return jsonify({"error": "Falta query"}), 400
        if len(query) > MAX_SEARCH_QUERY_LENGTH:
            return jsonify({"error": f"La búsqueda no puede superar {MAX_SEARCH_QUERY_LENGTH} caracteres"}), 400
        body, status = state.slskd.create_search(query)
        return jsonify(body), status

    @bp.route("/api/soulseek/users/status", methods=["POST"])
    def api_soulseek_user_statuses():
        data = request.get_json() or {}
        usernames = data.get("usernames", [])
        if not isinstance(usernames, list):
            return jsonify({"error": "usernames debe ser una lista"}), 400
        unique_usernames = list(dict.fromkeys(
            str(username).strip() for username in usernames if str(username).strip()
        ))[:50]
        return jsonify({
            "statuses": {
                username: state.slskd.user_status(username)
                for username in unique_usernames
            }
        })

    @bp.route("/api/search_soulseek/<search_id>", methods=["GET", "DELETE"])
    @bp.route("/api/search_slskr/<search_id>", methods=["GET", "DELETE"])
    def api_get_search_soulseek(search_id):
        try:
            uuid.UUID(search_id)
        except (ValueError, AttributeError):
            return jsonify({"error": "searchId inválido"}), 400
        if request.method == "DELETE":
            body, status = state.slskd.cancel_search(search_id)
            return jsonify(body), status
        body, status = state.slskd.get_search(search_id)
        return jsonify(body), status

    return bp
