"""Log endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from flask import Blueprint, jsonify

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("logs", __name__)

    @bp.route("/api/logs")
    def api_logs():
        return jsonify(state.logs.all())

    return bp
