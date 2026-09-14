"""Library folder/move, delete and cleanup endpoints."""

from __future__ import annotations

import os
import shutil
from typing import TYPE_CHECKING

from flask import Blueprint, jsonify, request

from backend.fs_utils import move_file_with_retry, remove_file_with_retry, safe_join

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("library", __name__)

    @bp.route("/api/library/index")
    def api_library_index():
        """Endpoint ligero: solo el índice de la biblioteca desde SQLite."""
        try:
            return jsonify({"library_index": state.library.index()})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @bp.route("/api/library/folder", methods=["POST"])
    def api_library_folder():
        data = request.get_json() or {}
        folder_name = str(data.get("folder_name", "")).strip().strip("/\\")
        if not folder_name:
            return jsonify({"error": "Falta el nombre de la carpeta"}), 400
        try:
            folder = safe_join(state.current_downloads_dir, folder_name)
        except ValueError:
            return jsonify({"error": "Nombre de carpeta inválido"}), 400
        try:
            os.makedirs(folder, exist_ok=True)
            state.logs.add(f"[library] carpeta creada: {folder_name}")
            return jsonify({"ok": True, "folder": folder_name.replace("\\", "/")})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @bp.route("/api/library/move", methods=["POST"])
    def api_library_move():
        data = request.get_json() or {}
        source_dir = str(data.get("source_dir", "")).strip()
        source_path = str(data.get("source_path", "")).strip()
        target_folder = str(data.get("target_folder", "")).strip().strip("/\\")
        if source_dir not in {"downloads", "previews"} or not source_path:
            return jsonify({"error": "Origen o archivo inválido"}), 400
        source_base = state.current_downloads_dir if source_dir == "downloads" else state.previews_dir
        try:
            source = safe_join(source_base, source_path)
            target_dir = safe_join(state.current_downloads_dir, target_folder)
        except ValueError:
            return jsonify({"error": "Ruta inválida"}), 403
        if not os.path.isfile(source):
            return jsonify({"error": "El archivo de origen no existe"}), 404
        os.makedirs(target_dir, exist_ok=True)
        destination = os.path.join(target_dir, os.path.basename(source))
        if os.path.abspath(source) == os.path.abspath(destination):
            return jsonify({"ok": True, "path": os.path.relpath(destination, state.current_downloads_dir).replace("\\", "/")})
        try:
            if os.path.exists(destination):
                remove_file_with_retry(source)
                if source_dir == "downloads":
                    state.library.remove_paths(source_path.replace("\\", "/"))
                new_path = os.path.relpath(destination, state.current_downloads_dir).replace("\\", "/")
                state.logs.add(f"[library] duplicado evitado; se conservó {new_path}")
                return jsonify({"ok": True, "path": new_path, "deduplicated": True})
            move_file_with_retry(source, destination)
            new_path = os.path.relpath(destination, state.current_downloads_dir).replace("\\", "/")
            if source_dir == "downloads":
                old_path = source_path.replace("\\", "/")
                state.library.move_path(old_path, new_path)
            state.logs.add(f"[library] archivo movido a {new_path}")
            return jsonify({"ok": True, "path": new_path})
        except Exception as exc:
            state.logs.add(f"[library] error al mover archivo: {exc}")
            return jsonify({"error": str(exc)}), 500

    @bp.route("/api/delete", methods=["POST"])
    def api_delete():
        data = request.get_json() or {}
        rel = data.get("path", "").strip().lstrip("/")
        dir_key = data.get("dir", "previews")
        if not rel:
            return jsonify({"error": "Falta path"}), 400
        if dir_key not in {"downloads", "previews"}:
            return jsonify({"error": "Directorio inválido"}), 400
        base = state.current_downloads_dir if dir_key == "downloads" else state.previews_dir
        try:
            full = safe_join(base, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        try:
            if not os.path.exists(full):
                return jsonify({"error": "El archivo ya no existe"}), 404
            if os.path.isdir(full):
                shutil.rmtree(full)
            else:
                os.remove(full)
            if dir_key == "downloads":
                state.library.remove_paths(rel)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @bp.route("/api/cleanup", methods=["POST"])
    def api_cleanup():
        try:
            removed = []
            previews_dir = state.previews_dir
            if os.path.isdir(previews_dir):
                for root, _, names in os.walk(previews_dir):
                    for n in names:
                        if n.endswith((".processing", ".failed")):
                            continue
                        full = os.path.join(root, n)
                        try:
                            if os.path.isfile(full):
                                os.remove(full)
                                removed.append(os.path.relpath(full, previews_dir).replace("\\", "/"))
                        except Exception:
                            pass
            inc_dir = os.path.join(previews_dir, ".incomplete")
            if os.path.isdir(inc_dir):
                try:
                    shutil.rmtree(inc_dir)
                    removed.append(".incomplete/")
                except Exception:
                    pass
            return jsonify({"removed": removed})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return bp
