"""Configuration endpoints."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from flask import Blueprint, jsonify, request

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("config", __name__)

    @bp.route("/api/config")
    def api_get_config():
        data = state.config_store.get()
        data["downloads_dir"] = state.current_downloads_dir
        return jsonify(data)

    @bp.route("/api/config", methods=["POST"])
    def api_update_config():
        data = request.get_json() or {}
        try:
            downloads_dir = str(data.get("downloads_dir", "")).strip()
            if downloads_dir:
                os.makedirs(downloads_dir, exist_ok=True)
                if not os.path.isdir(downloads_dir):
                    return jsonify({"error": "No es un directorio válido"}), 400
            saved = state.config_store.update(data)
            state.set_downloads_dir(saved.get("downloads_dir") or state.current_downloads_dir)
            state.slskd.refresh_config()
            state.slskd.start_from_config()
            state.logs.add("[config] Configuración actualizada desde la interfaz")
            saved["downloads_dir"] = state.current_downloads_dir
            return jsonify(saved)
        except Exception as exc:
            state.logs.add(f"[config] Error al guardar configuración: {exc}")
            return jsonify({"error": str(exc)}), 500

    @bp.route("/api/config/downloads", methods=["POST"])
    def api_set_downloads_dir():
        data = request.get_json() or {}
        new_dir = data.get("downloads_dir", "").strip()
        if not new_dir:
            return jsonify({"error": "Falta ruta"}), 400
        try:
            os.makedirs(new_dir, exist_ok=True)
            if not os.path.isdir(new_dir):
                return jsonify({"error": "No es un directorio válido"}), 400
            state.set_downloads_dir(new_dir)
            state.config_store.update({"downloads_dir": new_dir})
            state.logs.add(f"[config] Carpeta de descargas: {new_dir}")
            return jsonify({"ok": True, "downloads_dir": new_dir})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return bp
