import csv
import glob
import json
import os
import re
import shutil
import subprocess
import uuid
from collections import deque
from datetime import datetime
from urllib.parse import quote

import requests
from flask import Flask, abort, jsonify, request, send_file

from backend_config import BackendSettings
from local_config import LocalConfigStore
from spotify_service import read_tracks, run_conversion

SETTINGS = BackendSettings.from_environment()
SCRIPT_DIR = str(SETTINGS.script_dir)
DIST_DIR = str(SETTINGS.dist_dir)
RUN_PS1 = str(SETTINGS.run_script)
CSV_OUTPUT = str(SETTINGS.csv_output)
PLAYLIST_NAME_FILE = str(SETTINGS.playlist_name_file)
PREVIEWS_DIR = str(SETTINGS.previews_dir)
DOWNLOADS_DIR = str(SETTINGS.downloads_dir)
CONFIG_FILE = str(SETTINGS.config_file)


def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


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


config_store = LocalConfigStore(SETTINGS.config_file)
app_config = config_store.get()
current_downloads_dir = app_config.get("downloads_dir") or DOWNLOADS_DIR

SLSKD_URL = app_config.get("slskd_url") or SETTINGS.slskd_url
SLSKD_KEY = config_store.get_secret("slskd_api_key")
USE_SLSKD = True
SLSKD_PROCESS = None

app = Flask(__name__, static_folder=DIST_DIR, static_url_path="")

LOGS_FILE = str(SETTINGS.logs_file)


def load_logs():
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_logs():
    try:
        with open(LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(list(log_messages), f, ensure_ascii=False)
    except Exception:
        pass


log_messages = deque(load_logs(), maxlen=200)


def add_log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    log_messages.append(f"[{ts}] {msg}")
    save_logs()


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
def index():
    index_html = os.path.join(DIST_DIR, "index.html")
    if not os.path.exists(index_html):
        return "No se encontro el build de React. Corre 'npm run build' en spotify-soulseek-web/", 404
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
        return jsonify({"tracks": tracks})
    except Exception as e:
        add_log(f"[web] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/logs")
def api_logs():
    return jsonify(list(log_messages))


def _slskd_headers():
    return {"X-API-Key": SLSKD_KEY, "Content-Type": "application/json"}


def _start_slskd_from_config():
    global SLSKD_PROCESS
    path = config_store.get().get("slskd_path", "")
    if not path or not os.path.isfile(path):
        return False
    if SLSKD_PROCESS and SLSKD_PROCESS.poll() is None:
        return True
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    incomplete_dir = os.path.join(PREVIEWS_DIR, ".incomplete")
    os.makedirs(incomplete_dir, exist_ok=True)
    environment = os.environ.copy()
    environment.update(
        {
            "SLSKD_SLSK_USERNAME": config_store.get_secret("soulseek_username"),
            "SLSKD_SLSK_PASSWORD": config_store.get_secret("soulseek_password"),
            "SLSKD__WEB__HTTPS__DISABLED": "true",
            "SLSKD_NO_HTTPS": "true",
        }
    )
    SLSKD_PROCESS = subprocess.Popen(
        [path, "--downloads", PREVIEWS_DIR, "--incomplete", incomplete_dir],
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    add_log("[slskd] Servicio iniciado desde la configuración local")
    return True


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
    data["results"] = flat[:15]
    data["searchId"] = data.get("id")
    data["query"] = data.get("searchText")
    data["status"] = data.get("state") or data.get("status")
    data["responseCount"] = data.get("responseCount", 0)
    return data


def _preview_clip_path(full_path):
    return full_path + ".preview.mp3"


def _ensure_preview_clip(full_path):
    clip = _preview_clip_path(full_path)
    failed = clip + ".failed"
    if os.path.exists(clip):
        return clip
    if os.path.exists(failed):
        return "failed"
    processing = clip + ".processing"
    if os.path.exists(processing):
        return None  # todavía generando
    try:
        open(processing, "w").close()
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "quiet",
            "-i",
            full_path,
            "-ss",
            "0",
            "-t",
            "30",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "128k",
            "-vn",
            clip,
        ]
        subprocess.run(cmd, check=True, timeout=120)
        add_log(f"[preview] clip generado: {clip}")
        return clip
    except Exception as e:
        add_log(f"[preview] error ffmpeg: {e}")
        open(failed, "w").close()
        return "failed"
    finally:
        try:
            os.remove(processing)
        except Exception:
            pass


@app.route("/api/search_soulseek", methods=["POST"])
@app.route("/api/search_slskr", methods=["POST"])
def api_search_soulseek():
    data = request.get_json() or {}
    query = data.get("query", "").strip()
    if not query:
        add_log("[search] Error: falta query")
        return jsonify({"error": "Falta query"}), 400

    if USE_SLSKD:
        add_log(f"[slskd] POST {SLSKD_URL}/api/v0/searches")
        add_log(f"[slskd] searchText='{query}'")
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
            clip = _ensure_preview_clip(latest)
            if clip is None:
                return jsonify({
                    "state": "procesando",
                    "percentComplete": percent_complete,
                })
            if clip == "failed":
                return jsonify({
                    "state": "error",
                    "error": "No se pudo generar el preview (ffmpeg)",
                    "percentComplete": percent_complete,
                })
            rel = os.path.relpath(clip, PREVIEWS_DIR).replace("\\", "/")
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


@app.route("/api/config")
def api_get_config():
    data = config_store.get()
    data["downloads_dir"] = current_downloads_dir
    return jsonify(data)


@app.route("/api/config", methods=["POST"])
def api_update_config():
    global current_downloads_dir, SLSKD_URL, SLSKD_KEY
    data = request.get_json() or {}
    try:
        downloads_dir = str(data.get("downloads_dir", "")).strip()
        if downloads_dir:
            os.makedirs(downloads_dir, exist_ok=True)
            if not os.path.isdir(downloads_dir):
                return jsonify({"error": "No es un directorio válido"}), 400
        saved = config_store.update(data)
        current_downloads_dir = saved.get("downloads_dir") or current_downloads_dir
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
    global current_downloads_dir
    data = request.get_json() or {}
    new_dir = data.get("downloads_dir", "").strip()
    if not new_dir:
        return jsonify({"error": "Falta ruta"}), 400
    try:
        os.makedirs(new_dir, exist_ok=True)
        if not os.path.isdir(new_dir):
            return jsonify({"error": "No es un directorio válido"}), 400
        current_downloads_dir = new_dir
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
        # buscar en previews y mover a descargas
        matches = glob.glob(os.path.join(PREVIEWS_DIR, "**", glob.escape(base)), recursive=True)
        if not matches:
            # ya pudo haber sido movido
            matches = glob.glob(os.path.join(current_downloads_dir, "**", glob.escape(base)), recursive=True)
        if matches:
            latest = max(matches, key=os.path.getmtime)
            target_dir = os.path.join(current_downloads_dir, _safe_dirname(get_playlist_name()))
            if not latest.lower().startswith(current_downloads_dir.lower()):
                os.makedirs(target_dir, exist_ok=True)
                dest = os.path.join(target_dir, base)
                if not os.path.exists(dest):
                    try:
                        shutil.move(latest, dest)
                        latest = dest
                        add_log(f"[slskd] download moved to {dest}")
                    except Exception as e:
                        add_log(f"[slskd] download move error: {e}")
                        return jsonify({"state": "error", "error": str(e), "saved": False})
            rel = os.path.relpath(latest, current_downloads_dir).replace("\\", "/")
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
        return jsonify({"previews": files, "downloads": downloads_files, "transfers": transfers})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/delete", methods=["POST"])
def api_delete():
    data = request.get_json() or {}
    rel = data.get("path", "").strip().lstrip("/")
    dir_key = data.get("dir", "previews")
    if not rel:
        return jsonify({"error": "Falta path"}), 400
    if dir_key == "downloads":
        base = current_downloads_dir
    else:
        base = PREVIEWS_DIR
    try:
        full = _safe_join(base, rel)
    except ValueError:
        return jsonify({"error": "Path inválido"}), 403
    try:
        if os.path.isdir(full):
            shutil.rmtree(full)
        else:
            os.remove(full)
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
                    if n.endswith((".preview.mp3", ".processing", ".failed")):
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
