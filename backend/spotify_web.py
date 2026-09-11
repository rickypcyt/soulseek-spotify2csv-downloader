import csv
import glob
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from urllib.parse import quote

import requests
import spotipy
from flask import Flask, abort, jsonify, request, send_file

from backend.backend_config import BackendSettings
from backend.database import (
    get_library_index,
)
from backend.database import (
    load_logs as load_database_logs,
)
from backend.database import (
    move_library_path as move_database_path,
)
from backend.database import (
    register_library_track as register_database_track,
)
from backend.database import (
    remove_library_paths as remove_database_paths,
)
from backend.database import (
    save_logs as save_database_logs,
)
from backend.local_config import LocalConfigStore
from backend.spotify_service import read_tracks, run_conversion
from backend.spotify_to_csv import LocalSpotifyOAuth

SETTINGS = BackendSettings.from_environment()
SCRIPT_DIR = str(SETTINGS.script_dir)
DIST_DIR = str(SETTINGS.dist_dir)
RUN_PS1 = str(SETTINGS.run_script)
CSV_OUTPUT = str(SETTINGS.csv_output)
PLAYLIST_NAME_FILE = str(SETTINGS.playlist_name_file)
DOWNLOADS_DIR = str(SETTINGS.downloads_dir)
CONFIG_FILE = str(SETTINGS.config_file)


def _safe_dirname(name):
    if not name:
        return "sin_nombre"
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    return name.strip(" .") or "sin_nombre"


def get_playlist_name():
    if not os.path.exists(PLAYLIST_NAME_FILE):
        return ""
    try:
        with open(PLAYLIST_NAME_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def load_library_index():
    return get_library_index()


def register_library_track(track_key, track_name, artists, path):
    register_database_track(track_key, track_name, artists, path)


def move_library_path(old_path, new_path):
    move_database_path(old_path, new_path)


def remove_library_paths(path):
    remove_database_paths(path)


config_store = LocalConfigStore(SETTINGS.config_file)
app_config = config_store.get()
current_downloads_dir = app_config.get("downloads_dir") or DOWNLOADS_DIR
PREVIEWS_DIR = os.path.join(current_downloads_dir, "temp")

SLSKD_URL = app_config.get("slskd_url") or SETTINGS.slskd_url
SLSKD_KEY = config_store.get_secret("slskd_api_key")
USE_SLSKD = True
SLSKD_PROCESS = None
PENDING_DOWNLOADS = set()
PENDING_DOWNLOAD_FOLDERS = {}
PENDING_DOWNLOAD_METADATA = {}
ACTIVE_SEARCH_IDS = set()
ACTIVE_SEARCH_STARTED = {}
MAX_SEARCH_QUERY_LENGTH = 200
MAX_ACTIVE_SEARCHES = 50
MAX_SEARCH_LIFETIME_SECONDS = 120
SPOTIFY_AUTH_STATE = {"status": "not_configured", "error": None}
SPOTIFY_AUTH_THREAD = None
SPOTIFY_AUTH_LOCK = threading.Lock()

app = Flask(__name__, static_folder=DIST_DIR, static_url_path="")

log_messages = deque(load_database_logs(), maxlen=200)


def add_log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    log_messages.append(f"[{ts}] {msg}")
    save_database_logs(list(log_messages))


def fetch_csv(url):
    add_log(f"[spotify] Descargando: {url}")
    runtime_config = config_store.get()
    environment = os.environ.copy()
    environment.update(
        {
            "SPOTIPY_CLIENT_ID": runtime_config.get("spotify_client_id", ""),
            "SPOTIPY_CLIENT_SECRET": config_store.get_secret("spotify_client_secret"),
            "SPOTIPY_REDIRECT_URI": runtime_config.get("spotify_redirect_uri", ""),
        }
    )
    output = run_conversion(RUN_PS1, url, CSV_OUTPUT, environment=environment)
    add_log("[spotify] Descarga finalizada")
    return output


def read_csv():
    return read_tracks(CSV_OUTPUT)


@app.route("/")
@app.route("/settings")
@app.route("/logs")
@app.route("/library")
def index():
    index_html = os.path.join(DIST_DIR, "index.html")
    if not os.path.exists(index_html):
        return "No se encontro el build de React. Corre 'npm run build' en frontend/", 404
    return send_file(index_html)


@app.route("/api/preview", methods=["POST"])
def api_preview():
    data = request.get_json() or {}
    url = data.get("url", "").strip()
    if not url:
        add_log("[web] Error: falta URL")
        return jsonify({"error": "Pegá un link de Spotify."}), 400
    try:
        fetch_csv(url)
        tracks = read_csv()
        add_log(f"[web] {len(tracks)} pista(s) cargadas")
        return jsonify({"tracks": tracks, "playlist_name": get_playlist_name()})
    except Exception as e:
        add_log(f"[web] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/logs")
def api_logs():
    return jsonify(list(log_messages))


def _slskd_headers():
    return {"X-API-Key": SLSKD_KEY, "Content-Type": "application/json"}


def _ensure_slskd_api_key():
    global SLSKD_KEY
    if SLSKD_KEY:
        return SLSKD_KEY
    generated = secrets.token_hex(32)
    config_store.update({"slskd_api_key": generated})
    SLSKD_KEY = generated
    add_log("[slskd] API key generada y guardada en el almacén seguro")
    return SLSKD_KEY


def _start_slskd_from_config():
    global SLSKD_PROCESS
    path = config_store.get().get("slskd_path", "")
    if not path or not os.path.isfile(path):
        return False
    if SLSKD_PROCESS and SLSKD_PROCESS.poll() is None:
        return True
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    incomplete_dir = os.path.join(PREVIEWS_DIR, ".incomplete")
    webroot_dir = os.path.join(os.path.dirname(path), "wwwroot")
    os.makedirs(incomplete_dir, exist_ok=True)
    os.makedirs(webroot_dir, exist_ok=True)
    api_key = _ensure_slskd_api_key()
    environment = os.environ.copy()
    environment.update(
        {
            "SLSKD_SLSK_USERNAME": config_store.get_secret("soulseek_username"),
            "SLSKD_SLSK_PASSWORD": config_store.get_secret("soulseek_password"),
            "SLSKD__WEB__HTTPS__DISABLED": "true",
            "SLSKD__WEB__CONTENT_PATH": webroot_dir,
            "SLSKD_NO_HTTPS": "true",
            "SLSKD__WEB__AUTHENTICATION__API_KEYS__SOULSEEK_WEB__KEY": api_key,
            "SLSKD__WEB__AUTHENTICATION__API_KEYS__SOULSEEK_WEB__ROLE": "administrator",
            "SLSKD__WEB__AUTHENTICATION__API_KEYS__SOULSEEK_WEB__CIDR": "127.0.0.1/32,::1/128",
        }
    )
    SLSKD_PROCESS = subprocess.Popen(
        [path, "--headless", "--downloads", PREVIEWS_DIR, "--incomplete", incomplete_dir],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    add_log("[slskd] Servicio iniciado desde la configuración local")
    return True


def _ensure_slskd_available(wait_seconds=8):
    """Start configured slskd and wait briefly for its HTTP API to listen."""
    try:
        started_or_running = _start_slskd_from_config()
    except Exception as exc:
        add_log(f"[slskd] No se pudo iniciar: {exc}")
        return False

    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        try:
            # Any HTTP response proves the service is listening; auth/status is
            # handled by the actual API request afterward.
            requests.get(SLSKD_URL, headers=_slskd_headers(), timeout=1)
            return True
        except requests.RequestException:
            if started_or_running and SLSKD_PROCESS and SLSKD_PROCESS.poll() is not None:
                add_log(f"[slskd] El proceso terminó durante el arranque (código {SLSKD_PROCESS.returncode})")
                break
            time.sleep(0.25)
    return False


def _slskd_reachable():
    try:
        requests.get(SLSKD_URL, headers=_slskd_headers(), timeout=1)
        return True
    except requests.RequestException:
        return False


def _slskd_unavailable_message():
    configured_path = config_store.get().get("slskd_path", "")
    if configured_path:
        return (
            f"No se pudo conectar con slskd en {SLSKD_URL}. "
            "Verifica que slskd esté iniciado y que la URL/API key sean correctas."
        )
    return (
        f"slskd no está disponible en {SLSKD_URL}. "
        "Configura la ruta de slskd.exe en 'Configuración local' o inicia slskd manualmente."
    )


def _safe_join(base, relative):
    """Resolve a relative path and reject paths outside base."""
    base_path = os.path.abspath(base)
    candidate = os.path.abspath(os.path.join(base_path, relative.lstrip("/\\")))
    try:
        if os.path.commonpath([base_path, candidate]) != os.path.commonpath([base_path]):
            raise ValueError("Path fuera del directorio permitido")
    except ValueError as exc:
        raise ValueError("Path fuera del directorio permitido") from exc
    return candidate


def _normalize_slskd(data):
    """Convierte la respuesta de slskd al formato que entiende el front."""
    flat = []
    for resp in data.get("responses", []):
        username = resp.get("username") or resp.get("peer")
        upload_speed = resp.get("uploadSpeed") or resp.get("speed") or 0
        for f in resp.get("files", []):
            flat.append({
                "username": username,
                "filename": f.get("filename") or f.get("name") or f.get("path"),
                "size": f.get("size"),
                "bitrate": f.get("bitrate"),
                "length": f.get("length"),
                "extension": f.get("extension"),
                "speed": upload_speed,
            })
    flat.sort(key=lambda x: x.get("speed", 0), reverse=True)
    data["resultsCount"] = len(flat)
    data["results"] = flat
    data["searchId"] = data.get("id")
    data["query"] = data.get("searchText")
    data["status"] = data.get("state") or data.get("status")
    data["responseCount"] = data.get("responseCount", 0)
    return data


def _prune_active_searches():
    cutoff = time.monotonic() - MAX_SEARCH_LIFETIME_SECONDS
    expired = [search_id for search_id, started in ACTIVE_SEARCH_STARTED.items() if started < cutoff]
    for search_id in expired:
        ACTIVE_SEARCH_STARTED.pop(search_id, None)
        ACTIVE_SEARCH_IDS.discard(search_id)


@app.route("/api/search_soulseek", methods=["POST"])
@app.route("/api/search_slskr", methods=["POST"])
def api_search_soulseek():
    data = request.get_json() or {}
    query = str(data.get("query", "")).strip()
    if not query:
        add_log("[search] Error: falta query")
        return jsonify({"error": "Falta query"}), 400
    if len(query) > MAX_SEARCH_QUERY_LENGTH:
        return jsonify({"error": f"La búsqueda no puede superar {MAX_SEARCH_QUERY_LENGTH} caracteres"}), 400
    if USE_SLSKD:
        _prune_active_searches()
        if len(ACTIVE_SEARCH_IDS) >= MAX_ACTIVE_SEARCHES:
            return jsonify({"error": "Hay demasiadas búsquedas activas. Espera unos segundos e inténtalo de nuevo."}), 429
        add_log(f"[slskd] POST {SLSKD_URL}/api/v0/searches")
        add_log(f"[slskd] searchText='{query}'")
        if not _ensure_slskd_available():
            message = _slskd_unavailable_message()
            add_log(f"[slskd] {message}")
            return jsonify({"error": message, "status": "unavailable"}), 503
        try:
            search_id = str(uuid.uuid4())
            response = requests.post(
                f"{SLSKD_URL}/api/v0/searches",
                headers=_slskd_headers(),
                json={"id": search_id, "searchText": query, "searchTimeout": 30000},
                timeout=10,
            )
            try:
                data = response.json()
                add_log(f"[slskd] {response.status_code}: {data}")
                if not response.ok:
                    return jsonify({"error": f"Error {response.status_code}", "details": data}), response.status_code
                data = _normalize_slskd(data)
                ACTIVE_SEARCH_IDS.add(data["searchId"])
                ACTIVE_SEARCH_STARTED[data["searchId"]] = time.monotonic()
                return jsonify({
                    "searchId": data["searchId"],
                    "query": data["query"],
                    "resultsCount": data["resultsCount"],
                })
            except Exception:
                text = response.text
                add_log(f"[slskd] {response.status_code}: {text[:500]}")
                return jsonify({"error": f"Error {response.status_code}: {text[:500]}"}), response.status_code
        except Exception as e:
            add_log(f"[slskd] Error de conexión: {e}")
            return jsonify({"error": f"Error de conexión: {e}"}), 500

@app.route("/api/search_soulseek/<search_id>")
@app.route("/api/search_slskr/<search_id>")
def api_get_search_soulseek(search_id):
    try:
        uuid.UUID(search_id)
    except (ValueError, AttributeError):
        return jsonify({"error": "searchId inválido"}), 400
    if USE_SLSKD:
        try:
            state_resp = requests.get(
                f"{SLSKD_URL}/api/v0/searches/{search_id}",
                headers=_slskd_headers(),
                timeout=10,
            )
            if not state_resp.ok:
                add_log(f"[slskd] GET state {state_resp.status_code}: searchId={search_id}")
                return jsonify({"error": f"slskd {state_resp.status_code}", "status": "error"}), state_resp.status_code
            data = state_resp.json()
            # Los resultados reales están en el endpoint /responses
            try:
                resp = requests.get(
                    f"{SLSKD_URL}/api/v0/searches/{search_id}/responses",
                    headers=_slskd_headers(),
                    timeout=10,
                )
                if resp.ok:
                    data["responses"] = resp.json()
            except Exception as e:
                add_log(f"[slskd] GET responses error: {e}")
            data = _normalize_slskd(data)
            status = str(data.get("status") or data.get("state") or "").lower()
            if status in {"completed", "complete", "finished", "failed", "error", "cancelled", "canceled"}:
                ACTIVE_SEARCH_IDS.discard(search_id)
                ACTIVE_SEARCH_STARTED.pop(search_id, None)
            add_log(f"[slskd] GET data (searchId={search_id}): resultados={data['resultsCount']}")
            return jsonify(data)
        except Exception as e:
            add_log(f"[slskd] Error de conexión: {e}")
            return jsonify({"error": f"Error de conexión: {e}", "status": "error"}), 200


@app.route("/api/preview_audio", methods=["POST"])
def api_preview_audio():
    if not USE_SLSKD:
        return jsonify({"error": "Preview solo disponible con slskd"}), 400
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    filename = data.get("filename", "").strip()
    size = data.get("size", 0)
    if not username or not filename:
        return jsonify({"error": "falta username o filename"}), 400
    add_log(f"[slskd] preview enqueue user={username} file={filename}")
    try:
        response = requests.post(
            f"{SLSKD_URL}/api/v0/transfers/downloads/{quote(username, safe='')}",
            headers=_slskd_headers(),
            json=[{"filename": filename, "size": size}],
            timeout=10,
        )
        add_log(f"[slskd] preview enqueue {response.status_code}: {response.text[:300]}")
        if not response.ok:
            return jsonify({"error": f"slskd {response.status_code}", "status": "error"}), response.status_code
        return jsonify({"ok": True})
    except Exception as e:
        add_log(f"[slskd] preview enqueue error: {e}")
        return jsonify({"error": str(e), "status": "error"}), 200


@app.route("/api/preview/status")
def api_preview_status():
    if not USE_SLSKD:
        return jsonify({"state": "not configured"}), 200
    username = request.args.get("username", "").strip()
    filename = request.args.get("filename", "").strip()
    if not username or not filename:
        return jsonify({"state": "missing"}), 200
    try:
        response = requests.get(
            f"{SLSKD_URL}/api/v0/transfers/downloads/{quote(username, safe='')}",
            headers=_slskd_headers(),
            timeout=10,
        )
        if not response.ok:
            return jsonify({"state": "error", "statusCode": response.status_code}), 200
        data = response.json()
        target_state = "Unknown"
        percent_complete = 0
        for d in data.get("directories", []):
            for f in d.get("files", []):
                if f.get("filename") == filename or (f.get("filename") or "").endswith(filename):
                    percent_complete = f.get("percentComplete", 0)
                    target_state = f.get("state") or "Unknown"
                    break
            if target_state != "Unknown":
                break
        base = os.path.basename(filename.replace("\\", "/").replace("/", os.sep))
        matches = glob.glob(os.path.join(PREVIEWS_DIR, "**", glob.escape(base)), recursive=True)
        if matches:
            latest = max(matches, key=os.path.getmtime)
            rel = os.path.relpath(latest, PREVIEWS_DIR).replace("\\", "/")
            return jsonify({
                "state": "Completed",
                "path": rel,
                "percentComplete": 100,
            })
        return jsonify({"state": target_state, "percentComplete": percent_complete})
    except Exception as e:
        add_log(f"[slskd] preview status error: {e}")
        return jsonify({"state": "error"}), 200


@app.route("/api/preview/stream")
def api_preview_stream():
    rel = request.args.get("path", "").strip()
    if not rel:
        abort(400)
    try:
        full = _safe_join(PREVIEWS_DIR, rel)
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


@app.route("/api/file/download")
def api_file_download():
    rel = request.args.get("path", "").strip()
    dir_key = request.args.get("dir", "downloads").strip()
    if not rel or dir_key not in {"downloads", "previews"}:
        abort(400)
    base = current_downloads_dir if dir_key == "downloads" else PREVIEWS_DIR
    try:
        full = _safe_join(base, rel)
    except ValueError:
        abort(403)
    if not os.path.isfile(full):
        abort(404)
    return send_file(full, as_attachment=True, download_name=os.path.basename(full))


@app.route("/api/preview/save", methods=["POST"])
def api_save_preview():
    data = request.get_json() or {}
    rel = str(data.get("path", "")).strip()
    folder_name = str(data.get("folder_name", "")).strip() or get_playlist_name()
    track_key = str(data.get("track_key", "")).strip()
    track_name = str(data.get("track_name", "")).strip()
    artists = str(data.get("artists", "")).strip()
    if not rel:
        return jsonify({"error": "Falta el archivo de preview"}), 400
    try:
        source = _safe_join(PREVIEWS_DIR, rel)
    except ValueError:
        return jsonify({"error": "Path inválido"}), 403
    if not os.path.isfile(source):
        return jsonify({"error": "El preview ya no existe"}), 404

    target_dir = os.path.join(current_downloads_dir, _safe_dirname(folder_name))
    os.makedirs(target_dir, exist_ok=True)
    destination = os.path.join(target_dir, os.path.basename(source))
    try:
        if os.path.abspath(source) != os.path.abspath(destination):
            if os.path.exists(destination):
                os.remove(source)
            else:
                shutil.move(source, destination)
        saved_path = os.path.relpath(destination, current_downloads_dir).replace("\\", "/")
        register_library_track(track_key, track_name, artists, saved_path)
        add_log(f"[library] preview guardado en {saved_path}")
        return jsonify({"ok": True, "path": saved_path, "folder": _safe_dirname(folder_name)})
    except Exception as exc:
        add_log(f"[library] error al guardar preview: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/library/move", methods=["POST"])
def api_library_move():
    data = request.get_json() or {}
    source_dir = str(data.get("source_dir", "")).strip()
    source_path = str(data.get("source_path", "")).strip()
    target_folder = str(data.get("target_folder", "")).strip().strip("/\\")
    if source_dir not in {"downloads", "previews"} or not source_path:
        return jsonify({"error": "Origen o archivo inválido"}), 400
    source_base = current_downloads_dir if source_dir == "downloads" else PREVIEWS_DIR
    try:
        source = _safe_join(source_base, source_path)
        target_dir = _safe_join(current_downloads_dir, target_folder)
    except ValueError:
        return jsonify({"error": "Ruta inválida"}), 403
    if not os.path.isfile(source):
        return jsonify({"error": "El archivo de origen no existe"}), 404
    os.makedirs(target_dir, exist_ok=True)
    destination = os.path.join(target_dir, os.path.basename(source))
    if os.path.abspath(source) == os.path.abspath(destination):
        return jsonify({"ok": True, "path": os.path.relpath(destination, current_downloads_dir).replace("\\", "/")})
    if os.path.exists(destination):
        return jsonify({"error": "Ya existe un archivo con ese nombre en la carpeta destino"}), 409
    try:
        shutil.move(source, destination)
        new_path = os.path.relpath(destination, current_downloads_dir).replace("\\", "/")
        if source_dir == "downloads":
            old_path = source_path.replace("\\", "/")
            move_library_path(old_path, new_path)
        add_log(f"[library] archivo movido a {new_path}")
        return jsonify({"ok": True, "path": new_path})
    except Exception as exc:
        add_log(f"[library] error al mover archivo: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/file/stream")
def api_file_stream():
    rel = request.args.get("path", "").strip()
    dir_key = request.args.get("dir", "downloads").strip()
    if not rel or dir_key not in {"downloads", "previews"}:
        abort(400)
    base = current_downloads_dir if dir_key == "downloads" else PREVIEWS_DIR
    try:
        full = _safe_join(base, rel)
    except ValueError:
        abort(403)
    if not os.path.isfile(full):
        abort(404)
    mimetype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    return send_file(full, mimetype=mimetype, conditional=True, as_attachment=False)


def _spotify_oauth():
    config = config_store.get()
    client_id = config.get("spotify_client_id", "")
    client_secret = config_store.get_secret("spotify_client_secret")
    if not client_id or not client_secret:
        raise RuntimeError("Configura primero Spotify Client ID y Client Secret en Settings.")
    return LocalSpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=config.get("spotify_redirect_uri", "http://127.0.0.1:8080/callback"),
        scope="playlist-read-private playlist-read-collaborative",
        open_browser=True,
    )


def _spotify_auth_worker():
    global SPOTIFY_AUTH_STATE
    try:
        auth = _spotify_oauth()
        SPOTIFY_AUTH_STATE = {"status": "authenticating", "error": None}
        auth.get_access_token(as_dict=True)
        SPOTIFY_AUTH_STATE = {"status": "authenticated", "error": None}
        add_log("[spotify] Autorización completada desde Settings")
    except Exception as exc:
        SPOTIFY_AUTH_STATE = {"status": "error", "error": str(exc)}
        add_log(f"[spotify] Error de autorización: {exc}")


@app.route("/api/spotify/auth/status")
def api_spotify_auth_status():
    global SPOTIFY_AUTH_STATE
    config = config_store.get()
    if not config.get("spotify_client_id") or not config_store.get_secret("spotify_client_secret"):
        return jsonify({"status": "not_configured"})
    if SPOTIFY_AUTH_STATE.get("status") == "authenticating":
        return jsonify(SPOTIFY_AUTH_STATE)
    try:
        auth = _spotify_oauth()
        token = auth.cache_handler.get_cached_token()
        authenticated = bool(token and auth.validate_token(token))
        status = "authenticated" if authenticated else "not_authenticated"
        SPOTIFY_AUTH_STATE = {"status": status, "error": None}
        return jsonify(SPOTIFY_AUTH_STATE)
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)})


@app.route("/api/spotify/auth/start", methods=["POST"])
def api_spotify_auth_start():
    global SPOTIFY_AUTH_THREAD, SPOTIFY_AUTH_STATE
    with SPOTIFY_AUTH_LOCK:
        if SPOTIFY_AUTH_THREAD and SPOTIFY_AUTH_THREAD.is_alive():
            return jsonify({"status": "authenticating"}), 202
        try:
            _spotify_oauth()
        except Exception as exc:
            return jsonify({"status": "not_configured", "error": str(exc)}), 400
        SPOTIFY_AUTH_STATE = {"status": "authenticating", "error": None}
        SPOTIFY_AUTH_THREAD = threading.Thread(target=_spotify_auth_worker, daemon=True)
        SPOTIFY_AUTH_THREAD.start()
    return jsonify({"status": "authenticating"}), 202


@app.route("/api/spotify/playlists")
def api_spotify_playlists():
    try:
        auth = _spotify_oauth()
        token = auth.cache_handler.get_cached_token()
        if not token:
            return jsonify({"error": "Conecta Spotify desde Settings primero."}), 401
        spotify = spotipy.Spotify(auth_manager=auth)
        current_user = spotify.current_user()
        owner_id = current_user.get("id")
        playlists = []
        response = spotify.current_user_playlists(
            limit=50,
            fields="items(id,name,external_urls,owner(id,display_name),public),next",
        )
        while response and len(playlists) < 500:
            for playlist in response.get("items", []):
                if not playlist or not playlist.get("id"):
                    continue
                playlist_owner = (playlist.get("owner") or {}).get("id")
                if owner_id and playlist_owner != owner_id:
                    continue
                playlists.append({
                    "id": playlist["id"],
                    "name": playlist.get("name") or "Sin nombre",
                    "url": playlist.get("external_urls", {}).get(
                        "spotify",
                        f"https://open.spotify.com/playlist/{playlist['id']}",
                    ),
                })
            if not response.get("next"):
                break
            response = spotify.next(response)
        playlists.sort(key=lambda playlist: playlist["name"].casefold())
        return jsonify({"playlists": playlists})
    except Exception as exc:
        add_log(f"[spotify] Error al cargar playlists: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/config")
def api_get_config():
    data = config_store.get()
    data["downloads_dir"] = current_downloads_dir
    return jsonify(data)


@app.route("/api/config", methods=["POST"])
def api_update_config():
    global current_downloads_dir, PREVIEWS_DIR, SLSKD_URL, SLSKD_KEY
    data = request.get_json() or {}
    try:
        downloads_dir = str(data.get("downloads_dir", "")).strip()
        if downloads_dir:
            os.makedirs(downloads_dir, exist_ok=True)
            if not os.path.isdir(downloads_dir):
                return jsonify({"error": "No es un directorio válido"}), 400
        saved = config_store.update(data)
        current_downloads_dir = saved.get("downloads_dir") or current_downloads_dir
        PREVIEWS_DIR = os.path.join(current_downloads_dir, "temp")
        SLSKD_URL = saved.get("slskd_url") or SLSKD_URL
        SLSKD_KEY = config_store.get_secret("slskd_api_key")
        _start_slskd_from_config()
        add_log("[config] Configuración actualizada desde la interfaz")
        saved["downloads_dir"] = current_downloads_dir
        return jsonify(saved)
    except Exception as exc:
        add_log(f"[config] Error al guardar configuración: {exc}")
        return jsonify({"error": str(exc)}), 500


@app.route("/api/config/downloads", methods=["POST"])
def api_set_downloads_dir():
    global current_downloads_dir, PREVIEWS_DIR
    data = request.get_json() or {}
    new_dir = data.get("downloads_dir", "").strip()
    if not new_dir:
        return jsonify({"error": "Falta ruta"}), 400
    try:
        os.makedirs(new_dir, exist_ok=True)
        if not os.path.isdir(new_dir):
            return jsonify({"error": "No es un directorio válido"}), 400
        current_downloads_dir = new_dir
        PREVIEWS_DIR = os.path.join(new_dir, "temp")
        config_store.update({"downloads_dir": new_dir})
        add_log(f"[config] Carpeta de descargas: {new_dir}")
        return jsonify({"ok": True, "downloads_dir": new_dir})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/download", methods=["POST"])
def api_download():
    if not USE_SLSKD:
        return jsonify({"error": "Descarga solo disponible con slskd"}), 400
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
    add_log(f"[slskd] download enqueue user={username} file={filename}")
    try:
        response = requests.post(
            f"{SLSKD_URL}/api/v0/transfers/downloads/{quote(username, safe='')}",
            headers=_slskd_headers(),
            json=[{"filename": filename, "size": size}],
            timeout=10,
        )
        add_log(f"[slskd] download enqueue {response.status_code}: {response.text[:300]}")
        if not response.ok:
            return jsonify({"error": f"slskd {response.status_code}", "status": "error"}), response.status_code
        download_key = (username, filename)
        PENDING_DOWNLOADS.add(download_key)
        PENDING_DOWNLOAD_FOLDERS[download_key] = folder_name
        PENDING_DOWNLOAD_METADATA[download_key] = {
            "track_key": track_key,
            "track_name": track_name,
            "artists": artists,
        }
        return jsonify({"ok": True})
    except Exception as e:
        add_log(f"[slskd] download enqueue error: {e}")
        return jsonify({"error": str(e), "status": "error"}), 200


@app.route("/api/download/status")
def api_download_status():
    if not USE_SLSKD:
        return jsonify({"state": "not configured"}), 200
    username = request.args.get("username", "").strip()
    filename = request.args.get("filename", "").strip()
    requested_folder = request.args.get("folder_name", "").strip()
    if not username or not filename:
        return jsonify({"state": "missing"}), 200
    try:
        response = requests.get(
            f"{SLSKD_URL}/api/v0/transfers/downloads/{quote(username, safe='')}",
            headers=_slskd_headers(),
            timeout=10,
        )
        if not response.ok:
            return jsonify({"state": "error", "statusCode": response.status_code}), 200
        data = response.json()
        target_state = "Unknown"
        percent_complete = 0
        for d in data.get("directories", []):
            for f in d.get("files", []):
                if f.get("filename") == filename or (f.get("filename") or "").endswith(filename):
                    percent_complete = f.get("percentComplete", 0)
                    target_state = f.get("state") or "Unknown"
                    break
            if target_state != "Unknown":
                break
        if str(target_state).lower() not in {"completed", "complete", "succeeded", "finished"}:
            return jsonify({"state": target_state, "percentComplete": percent_complete})
        base = os.path.basename(filename.replace("\\", "/").replace("/", os.sep))
        # Buscar en temporales y mover el archivo terminado a la carpeta final.
        matches = glob.glob(os.path.join(PREVIEWS_DIR, "**", glob.escape(base)), recursive=True)
        if not matches:
            # Ya pudo haber sido movido a la carpeta final.
            matches = glob.glob(os.path.join(current_downloads_dir, "**", glob.escape(base)), recursive=True)
        if matches:
            latest = max(matches, key=os.path.getmtime)
            latest_abs = os.path.abspath(latest)
            previews_abs = os.path.abspath(PREVIEWS_DIR)
            folder_name = requested_folder or PENDING_DOWNLOAD_FOLDERS.get((username, filename)) or get_playlist_name()
            target_dir = os.path.join(current_downloads_dir, _safe_dirname(folder_name))
            add_log(f"[library] destino de descarga: {target_dir}")
            is_in_previews = os.path.commonpath([latest_abs, previews_abs]) == previews_abs
            if is_in_previews:
                os.makedirs(target_dir, exist_ok=True)
                dest = os.path.join(target_dir, base)
                try:
                    if os.path.abspath(dest) == latest_abs:
                        pass
                    elif os.path.exists(dest):
                        os.remove(latest)
                        add_log(f"[slskd] temporal eliminado; ya existía {dest}")
                    else:
                        shutil.move(latest, dest)
                        add_log(f"[slskd] download moved to {dest}")
                    latest = dest
                except Exception as e:
                    add_log(f"[slskd] download move error: {e}")
                    return jsonify({"state": "error", "error": str(e), "saved": False})
            rel = os.path.relpath(latest, current_downloads_dir).replace("\\", "/")
            download_key = (username, filename)
            metadata = PENDING_DOWNLOAD_METADATA.pop(download_key, {})
            register_library_track(
                metadata.get("track_key"),
                metadata.get("track_name"),
                metadata.get("artists"),
                rel,
            )
            PENDING_DOWNLOADS.discard(download_key)
            PENDING_DOWNLOAD_FOLDERS.pop(download_key, None)
            return jsonify({"state": "Completed", "path": rel, "saved": True, "percentComplete": 100})
        return jsonify({"state": target_state, "percentComplete": percent_complete})
    except Exception as e:
        add_log(f"[slskd] download status error: {e}")
        return jsonify({"state": "error"}), 200


@app.route("/api/cancel", methods=["POST"])
def api_cancel():
    if not USE_SLSKD:
        return jsonify({"error": "Cancelar solo disponible con slskd"}), 400
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    filename = data.get("filename", "").strip()
    if not username or not filename:
        return jsonify({"error": "falta username o filename"}), 400
    try:
        response = requests.get(
            f"{SLSKD_URL}/api/v0/transfers/downloads/{quote(username, safe='')}",
            headers=_slskd_headers(),
            timeout=10,
        )
        if not response.ok:
            return jsonify({"error": f"slskd {response.status_code}"}), response.status_code
        data = response.json()
        transfer_id = None
        for d in data.get("directories", []):
            for f in d.get("files", []):
                if f.get("filename") == filename or (f.get("filename") or "").endswith(filename):
                    transfer_id = f.get("id")
                    break
            if transfer_id:
                break
        if not transfer_id:
            return jsonify({"ok": True, "cancelled": False})
        cancel_url = f"{SLSKD_URL}/api/v0/transfers/downloads/{quote(username, safe='')}/{quote(str(transfer_id), safe='')}?remove=true"
        cancel_resp = requests.delete(cancel_url, headers=_slskd_headers(), timeout=10)
        add_log(f"[slskd] cancel {username}/{transfer_id}: {cancel_resp.status_code}")
        if not cancel_resp.ok:
            return jsonify({"error": f"slskd cancel {cancel_resp.status_code}"}), cancel_resp.status_code
        return jsonify({"ok": True, "cancelled": True})
    except Exception as e:
        add_log(f"[slskd] cancel error: {e}")
        return jsonify({"error": str(e)}), 200


@app.route("/api/download/csv")
def api_download_csv():
    if not os.path.exists(CSV_OUTPUT):
        abort(404)
    return send_file(CSV_OUTPUT, as_attachment=True, download_name="spotify_output.csv")


@app.route("/api/download/soulseek")
def api_download_soulseek():
    if not os.path.exists(CSV_OUTPUT):
        abort(404)
    txt_path = os.path.join(SCRIPT_DIR, "web_soulseek_searches.txt")
    with open(CSV_OUTPUT, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    with open(txt_path, "w", encoding="utf-8") as f:
        f.writelines(row["search_query"] + "\n" for row in rows)
    return send_file(txt_path, as_attachment=True, download_name="soulseek_searches.txt")


@app.route("/api/diagnostics")
def api_diagnostics():
    try:
        files = []
        if os.path.isdir(PREVIEWS_DIR):
            for root, _, names in os.walk(PREVIEWS_DIR):
                for n in names:
                    full = os.path.join(root, n)
                    rel = os.path.relpath(full, PREVIEWS_DIR).replace("\\", "/")
                    files.append({"path": rel, "size": os.path.getsize(full), "dir": "previews"})
        downloads_files = []
        if os.path.isdir(current_downloads_dir):
            for root, _, names in os.walk(current_downloads_dir):
                for n in names:
                    full = os.path.join(root, n)
                    rel = os.path.relpath(full, current_downloads_dir).replace("\\", "/")
                    downloads_files.append({"path": rel, "size": os.path.getsize(full), "dir": "downloads"})
        transfers = []
        if USE_SLSKD:
            try:
                r = requests.get(
                    f"{SLSKD_URL}/api/v0/transfers/downloads",
                    headers=_slskd_headers(),
                    timeout=10,
                )
                if r.ok:
                    data = r.json()
                    entries = data if isinstance(data, list) else data.get("downloads", [])
                    for entry in entries:
                        username = entry.get("username")
                        for d in entry.get("directories", []):
                            for f in d.get("files", []):
                                state = f.get("state") or "Unknown"
                                if state in ("Completed", "Succeeded", "Complete"):
                                    continue
                                transfers.append({
                                    "username": username,
                                    "filename": f.get("filename"),
                                    "state": state,
                                    "percentComplete": f.get("percentComplete", 0),
                                })
            except Exception as e:
                add_log(f"[diagnostics] error slskd: {e}")
        current_config = config_store.get()
        slskd_path = current_config.get("slskd_path", "")
        downloads_dir = current_downloads_dir
        return jsonify({
            "previews": files,
            "downloads": downloads_files,
            "library_index": load_library_index(),
            "transfers": transfers,
            "configuration": {
                "backend": {"ready": True},
                "spotify": {
                    "clientIdConfigured": bool(current_config.get("spotify_client_id")),
                    "clientSecretConfigured": bool(current_config.get("spotify_client_secret_configured")),
                },
                "slskd": {
                    "url": SLSKD_URL,
                    "reachable": _slskd_reachable(),
                    "apiKeyConfigured": bool(current_config.get("slskd_api_key_configured")),
                    "executableConfigured": bool(slskd_path),
                    "executableExists": bool(slskd_path and os.path.isfile(slskd_path)),
                },
                "downloads": {
                    "path": downloads_dir,
                    "exists": bool(downloads_dir and os.path.isdir(downloads_dir)),
                },
            },
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/delete", methods=["POST"])
def api_delete():
    data = request.get_json() or {}
    rel = data.get("path", "").strip().lstrip("/")
    dir_key = data.get("dir", "previews")
    if not rel:
        return jsonify({"error": "Falta path"}), 400
    if dir_key not in {"downloads", "previews"}:
        return jsonify({"error": "Directorio inválido"}), 400
    base = current_downloads_dir if dir_key == "downloads" else PREVIEWS_DIR
    try:
        full = _safe_join(base, rel)
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
            remove_library_paths(rel)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cleanup", methods=["POST"])
def api_cleanup():
    try:
        removed = []
        if os.path.isdir(PREVIEWS_DIR):
            for root, _, names in os.walk(PREVIEWS_DIR):
                for n in names:
                    if n.endswith((".processing", ".failed")):
                        continue
                    full = os.path.join(root, n)
                    try:
                        if os.path.isfile(full):
                            os.remove(full)
                            removed.append(os.path.relpath(full, PREVIEWS_DIR).replace("\\", "/"))
                    except Exception:
                        pass
        inc_dir = os.path.join(PREVIEWS_DIR, ".incomplete")
        if os.path.isdir(inc_dir):
            try:
                shutil.rmtree(inc_dir)
                removed.append(".incomplete/")
            except Exception:
                pass
        return jsonify({"removed": removed})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    dev_mode = os.getenv("SOULSEEK_DEV") == "1"
    _start_slskd_from_config()
    app.run(debug=dev_mode, use_reloader=dev_mode, host="127.0.0.1", port=5000)
