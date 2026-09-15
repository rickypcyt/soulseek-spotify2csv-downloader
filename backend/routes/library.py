"""Library folder/move, delete and cleanup endpoints."""

from __future__ import annotations

import os
import re
import shutil
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import requests
from flask import Blueprint, Response, jsonify, request

from backend import musicbrainz
from backend.fs_utils import move_file_with_retry, remove_file_with_retry, safe_dirname, safe_join
from backend.library_service import embed_cover, extract_embedded_cover, write_audio_metadata, write_bpm

if TYPE_CHECKING:
    from backend.runtime import RuntimeState


def create_blueprint(state: RuntimeState) -> Blueprint:
    bp = Blueprint("library", __name__)

    def _best_library_entry(rel: str) -> dict:
        entries = [item for item in state.library.index().values() if item.get("path") == rel]
        if not entries:
            return {}

        def _score(item):
            tk = str(item.get("track_key", ""))
            is_spotify = len(tk) == 22 and ":" not in tk
            has_name = bool(str(item.get("track_name", "")).strip())
            has_artists = bool(str(item.get("artists", "")).strip())
            return (is_spotify, has_name, has_artists)

        return max(entries, key=_score)

    def _search_metadata(query: str) -> dict[str, str]:
        try:
            return musicbrainz.search_track_metadata(query)
        except Exception:
            pass
        try:
            return state.spotify_auth.search_track_metadata(query)
        except Exception:
            raise RuntimeError("No se encontró el track en MusicBrainz ni en Spotify.")

    def metadata_for_file(rel: str) -> dict[str, str]:
        entry = _best_library_entry(rel)
        track_name = str(entry.get("track_name", "")).strip()
        artists = str(entry.get("artists", "")).strip()
        track_key = str(entry.get("track_key", "")).strip()
        album = ""
        cover_url = ""
        if (track_name or artists):
            try:
                mb = musicbrainz.search_track_metadata(f"{artists} {track_name}")
                album = mb.get("album", "")
                cover_url = mb.get("cover_url", "")
            except Exception:
                pass
        if not (album and cover_url) and track_key and len(track_key) == 22 and ":" not in track_key:
            try:
                spotify = state.spotify_auth.get_track_metadata(track_key)
                album = album or spotify.get("album", "")
                cover_url = cover_url or spotify.get("cover_url", "")
            except Exception:
                pass
        if track_name or artists:
            return {"track_key": track_key, "track_name": track_name, "artists": artists, "album": album, "cover_url": cover_url}
        stem = os.path.splitext(os.path.basename(rel))[0].replace("_", " ")
        query = " ".join(part for part in re.split(r"\s+-\s+", stem, maxsplit=1) if part).strip()
        return _search_metadata(query)

    @bp.route("/api/library/index")
    def api_library_index():
        """Endpoint ligero: solo el índice de la biblioteca desde SQLite."""
        try:
            return jsonify({"library_index": state.library.index()})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @bp.route("/api/library/cover")
    def api_library_cover():
        rel = str(request.args.get("path", "")).strip().lstrip("/\\")
        dir_key = str(request.args.get("dir", "downloads")).strip()
        if not rel:
            return jsonify({"error": "Falta path"}), 400
        if dir_key not in {"downloads", "previews"}:
            return jsonify({"error": "Directorio inválido"}), 400
        base_dir = state.current_downloads_dir if dir_key == "downloads" else state.previews_dir
        try:
            full = safe_join(base_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        cover = extract_embedded_cover(full)
        if not cover:
            return jsonify({"error": "El archivo no contiene portada embebida"}), 404
        data, mime = cover
        return Response(data, mimetype=mime, headers={"Cache-Control": "public, max-age=3600"})

    @bp.route("/api/library/cover/embed", methods=["POST"])
    def api_embed_library_cover():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        cover_url = str(data.get("cover_url", "")).strip()
        if not rel or not cover_url:
            return jsonify({"error": "Falta el archivo o la URL de portada"}), 400
        parsed = urlparse(cover_url)
        if parsed.scheme != "https" or not parsed.hostname or not (
            parsed.hostname == "scdn.co" or parsed.hostname.endswith(".scdn.co")
            or parsed.hostname == "spotifycdn.com" or parsed.hostname.endswith(".spotifycdn.com")
        ):
            return jsonify({"error": "La portada debe proceder de un dominio de imágenes de Spotify"}), 400
        try:
            full = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        try:
            response = requests.get(cover_url, timeout=20)
            response.raise_for_status()
            image = response.content
            if len(image) > 10 * 1024 * 1024:
                return jsonify({"error": "La portada es demasiado grande"}), 413
            mime = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if mime not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
                return jsonify({"error": "La respuesta no contiene una imagen válida"}), 400
            embed_cover(full, image, mime)
            state.logs.add(f"[library] portada embebida: {rel}")
            return jsonify({"ok": True, "path": rel})
        except requests.RequestException as exc:
            return jsonify({"error": f"No se pudo descargar la portada: {exc}"}), 502
        except (OSError, ValueError) as exc:
            state.logs.add(f"[library] error al insertar portada: {exc}")
            return jsonify({"error": str(exc)}), 400

    @bp.route("/api/library/cover/search-embed", methods=["POST"])
    def api_search_and_embed_library_cover():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        dir_key = str(data.get("dir", "downloads")).strip()
        if not rel:
            return jsonify({"error": "Falta el archivo"}), 400
        if dir_key not in {"downloads", "previews"}:
            return jsonify({"error": "Directorio inválido"}), 400
        base_dir = state.current_downloads_dir if dir_key == "downloads" else state.previews_dir
        try:
            full = safe_join(base_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        def _search_cover(track_name: str, artists: str) -> str:
            try:
                return musicbrainz.search_cover(track_name, artists)
            except Exception:
                pass
            try:
                return state.spotify_auth.search_cover(track_name, artists)
            except Exception:
                raise RuntimeError("No se encontró una portada en MusicBrainz ni en Spotify.")

        try:
            metadata = metadata_for_file(rel)
            cover_url = metadata.get("cover_url") or _search_cover(metadata["track_name"], metadata["artists"])
            response = requests.get(cover_url, timeout=20)
            response.raise_for_status()
            image = response.content
            mime = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if len(image) > 10 * 1024 * 1024:
                return jsonify({"error": "La portada es demasiado grande"}), 413
            if mime not in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
                return jsonify({"error": "La respuesta no contiene una imagen válida"}), 400
            embed_cover(full, image, mime)
            state.logs.add(f"[library] portada encontrada y embebida: {rel}")
            return jsonify({"ok": True, "path": rel, "cover_url": cover_url})
        except requests.RequestException as exc:
            return jsonify({"error": f"No se pudo descargar la portada: {exc}"}), 502
        except (OSError, RuntimeError, ValueError) as exc:
            state.logs.add(f"[library] error buscando portada: {exc}")
            return jsonify({"error": str(exc)}), 400

    @bp.route("/api/library/metadata", methods=["POST"])
    def api_update_library_metadata():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        track_name = str(data.get("track_name", "")).strip()
        artists = str(data.get("artists", "")).strip()
        if not rel or not track_name:
            return jsonify({"error": "Falta path o nombre"}), 400
        try:
            full = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        try:
            write_audio_metadata(full, track_name, artists)
            state.library.update_metadata(rel, track_name, artists)
            state.logs.add(f"[library] metadata actualizada: {rel}")
            return jsonify({"ok": True, "path": rel, "track_name": track_name, "artists": artists})
        except (OSError, ValueError) as exc:
            state.logs.add(f"[library] error actualizando metadata: {exc}")
            return jsonify({"error": str(exc)}), 400

    @bp.route("/api/library/metadata/search", methods=["POST"])
    def api_search_library_metadata():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        if not rel:
            return jsonify({"error": "Falta el archivo"}), 400
        try:
            full = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        entry = _best_library_entry(rel)
        query = " ".join(filter(None, [str(entry.get("artists", "")).strip(), str(entry.get("track_name", "")).strip()]))
        if not query:
            query = os.path.splitext(os.path.basename(rel))[0].replace("_", " ")
        try:
            metadata = _search_metadata(query)
            write_audio_metadata(full, metadata["track_name"], metadata["artists"], metadata.get("album", ""))
            state.library.register_track(
                metadata["track_key"], metadata["track_name"], metadata["artists"], rel, metadata.get("cover_url", "")
            )
            state.logs.add(f"[library] metadata Spotify guardada: {rel}")
            return jsonify({"ok": True, "path": rel, **metadata})
        except (OSError, RuntimeError, ValueError) as exc:
            state.logs.add(f"[library] error buscando metadata Spotify: {exc}")
            return jsonify({"error": str(exc)}), 400

    @bp.route("/api/library/bpm/sync", methods=["POST"])
    def api_sync_library_bpm():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        if not rel:
            return jsonify({"error": "Falta el archivo"}), 400
        try:
            full = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        try:
            metadata = metadata_for_file(rel)
            bpm = state.spotify_auth.search_bpm(metadata["track_key"], metadata["track_name"], metadata["artists"])
            write_bpm(full, bpm)
            state.library.register_track(
                metadata["track_key"],
                metadata["track_name"],
                metadata["artists"],
                rel,
                metadata.get("cover_url", ""),
            )
            state.library.update_bpm(metadata["track_key"], bpm)
            state.logs.add(f"[library] BPM {bpm} guardado: {rel}")
            return jsonify({"ok": True, "path": rel, "bpm": bpm})
        except (OSError, RuntimeError, ValueError) as exc:
            state.logs.add(f"[library] error guardando BPM: {exc}")
            return jsonify({"error": str(exc)}), 400

    @bp.route("/api/library/bpm", methods=["POST"])
    def api_update_library_bpm():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        bpm = data.get("bpm")
        if not rel:
            return jsonify({"error": "Falta el archivo"}), 400
        try:
            bpm = float(bpm)
            if bpm <= 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "BPM inválido"}), 400
        try:
            full = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(full):
            return jsonify({"error": "El archivo no existe"}), 404
        try:
            metadata = metadata_for_file(rel)
            write_bpm(full, bpm)
            state.library.register_track(
                metadata["track_key"],
                metadata["track_name"],
                metadata["artists"],
                rel,
                metadata.get("cover_url", ""),
            )
            state.library.update_bpm(metadata["track_key"], bpm)
            state.logs.add(f"[library] BPM {bpm} guardado manualmente: {rel}")
            return jsonify({"ok": True, "path": rel, "bpm": bpm})
        except (OSError, RuntimeError, ValueError) as exc:
            state.logs.add(f"[library] error guardando BPM manual: {exc}")
            return jsonify({"error": str(exc)}), 400

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

    @bp.route("/api/library/rename", methods=["POST"])
    def api_library_rename():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        if not rel:
            return jsonify({"error": "Falta path"}), 400
        try:
            source = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(source):
            return jsonify({"error": "El archivo no existe"}), 404
        try:
            metadata = metadata_for_file(rel)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 400
        track_name = metadata["track_name"]
        artists = metadata["artists"]
        extension = os.path.splitext(source)[1]
        filename = safe_dirname(f"{track_name} - {artists}") + extension
        destination = os.path.join(os.path.dirname(source), filename)
        new_rel = os.path.relpath(destination, state.current_downloads_dir).replace("\\", "/")
        if os.path.abspath(source) == os.path.abspath(destination):
            return jsonify({"ok": True, "path": new_rel})
        if os.path.exists(destination):
            return jsonify({"error": f"Ya existe un archivo con el nombre {filename}"}), 409
        try:
            move_file_with_retry(source, destination)
            try:
                write_audio_metadata(destination, track_name, artists, metadata.get("album", ""))
            except ValueError as exc:
                state.logs.add(f"[library] metadata no escrita en rename: {exc}")
            state.library.move_path(rel, new_rel)
            state.library.register_track(
                metadata["track_key"],
                metadata["track_name"],
                metadata["artists"],
                new_rel,
                metadata.get("cover_url", ""),
            )
            state.logs.add(f"[library] archivo renombrado: {rel} -> {new_rel}")
            return jsonify({"ok": True, "path": new_rel})
        except Exception as exc:
            state.logs.add(f"[library] error al renombrar archivo: {exc}")
            return jsonify({"error": str(exc)}), 500

    @bp.route("/api/library/rename/preview", methods=["POST"])
    def api_library_rename_preview():
        data = request.get_json() or {}
        rel = str(data.get("path", "")).strip().lstrip("/\\")
        if not rel:
            return jsonify({"error": "Falta path"}), 400
        try:
            source = safe_join(state.current_downloads_dir, rel)
        except ValueError:
            return jsonify({"error": "Path inválido"}), 403
        if not os.path.isfile(source):
            return jsonify({"error": "El archivo no existe"}), 404
        try:
            metadata = metadata_for_file(rel)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 400
        track_name = metadata["track_name"]
        artists = metadata["artists"]
        extension = os.path.splitext(source)[1]
        filename = safe_dirname(f"{track_name} - {artists}") + extension
        destination = os.path.join(os.path.dirname(source), filename)
        new_rel = os.path.relpath(destination, state.current_downloads_dir).replace("\\", "/")
        if os.path.abspath(source) == os.path.abspath(destination):
            return jsonify({"ok": True, "path": new_rel, "filename": os.path.basename(destination), "track_name": track_name, "artists": artists, "album": metadata.get("album", "")})
        if os.path.exists(destination):
            return jsonify({"error": f"Ya existe un archivo con el nombre {filename}"}), 409
        return jsonify({"ok": True, "path": new_rel, "filename": os.path.basename(destination), "track_name": track_name, "artists": artists, "album": metadata.get("album", "")})

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
