import csv
import glob
import json
import mimetypes
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(SCRIPT_DIR, "spotify-soulseek-web", "dist")
RUN_PS1 = os.path.join(SCRIPT_DIR, "run.ps1")
CSV_OUTPUT = os.path.join(SCRIPT_DIR, "web_output.csv")
PLAYLIST_NAME_FILE = os.path.join(SCRIPT_DIR, "web_playlist_name.txt")
PREVIEWS_DIR = os.path.join(SCRIPT_DIR, "previews")
DOWNLOADS_DIR = os.getenv(
    "SLSKD_DOWNLOADS_DIR",
    os.path.join(os.path.expanduser("~"), "Music", "Soulseek Downloads"),
)
CONFIG_FILE = os.path.join(SCRIPT_DIR, "web_config.json")


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


app_config = load_config()
current_downloads_dir = app_config.get("downloads_dir", DOWNLOADS_DIR)

SLSKR_URL = os.getenv("SLSKR_URL", "http://127.0.0.1:5030")
SLSKR_TOKEN = os.getenv("SLSKR_API_TOKEN", "")

SLSKD_URL = os.getenv("SLSKD_URL", "http://127.0.0.1:5030")
SLSKD_KEY = os.getenv("SLSKD_API_KEY", "")
USE_SLSKD = bool(SLSKD_KEY)

app = Flask(__name__, static_folder=DIST_DIR, static_url_path="")

LOGS_FILE = os.path.join(SCRIPT_DIR, "web_logs.json")


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
    cmd = [
        "powershell",
        "-ExecutionPolicy", "Bypass",
        "-File", RUN_PS1,
        "-Modo", "cli",
        "-Url", url,
        "-Output", CSV_OUTPUT,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout:
        add_log("[spotify] stdout:\n" + result.stdout)
    if result.stderr:
        add_log("[spotify] stderr:\n" + result.stderr)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or "Error desconocido")
    add_log("[spotify] Descarga finalizada")


def read_csv():
    with open(CSV_OUTPUT, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


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


@app.route("/api/search_slskr", methods=["POST"])
def api_search_slskr():
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

    if not SLSKR_TOKEN:
        add_log("[slskr] Error: falta SLSKR_API_TOKEN")
        return jsonify({"error": "Falta SLSKR_API_TOKEN"}), 400
    add_log(f"[slskr] POST {SLSKR_URL}/api/v0/searches")
    add_log(f"[slskr] query='{query}', target='global'")
    try:
        response = requests.post(
            f"{SLSKR_URL}/api/v0/searches",
            headers={
                "Authorization": f"Bearer {SLSKR_TOKEN}",
                "Content-Type": "application/json",
            },
            json={"query": query, "target": "global"},
            timeout=10,
        )
        try:
            data = response.json()
            add_log(f"[slskr] {response.status_code}: {data}")
            if not response.ok:
                return jsonify({"error": f"Error {response.status_code}", "details": data}), response.status_code
            search_id = data.get("searchId") or data.get("id") if isinstance(data, dict) else None
            results = data.get("results", [])
            return jsonify({
                "searchId": search_id,
                "query": query,
                "resultsCount": len(results) if isinstance(results, list) else 0,
            })
        except Exception:
            text = response.text
            add_log(f"[slskr] {response.status_code}: {text[:500]}")
            if response.ok:
                return jsonify({"searchId": None, "query": query, "resultsCount": 0})
            return jsonify({"error": f"Error {response.status_code}: {text[:500]}"}), response.status_code
    except Exception as e:
        add_log(f"[slskr] Error de conexión: {e}")
        return jsonify({"error": f"Error de conexión: {e}"}), 500


@app.route("/api/search_slskr/<search_id>")
def api_get_search_slskr(search_id):
    if USE_SLSKD:
        try:
            state_resp = requests.get(
                f"{SLSKD_URL}/api/v0/searches/{search_id}",
                headers=_slskd_headers(),
                timeout=10,
            )
            if not state_resp.ok:
                add_log(f"[slskd] GET state {state_resp.status_code}: searchId={search_id}")
                return jsonify({"error": f"slskd {state_resp.status_code}", "status": "error"}), 200
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

    if not SLSKR_TOKEN:
        return jsonify({"error": "Falta SLSKR_API_TOKEN"}), 400
    try:
        # El endpoint correcto de slskr es /api/searches/{id} (sin v0)
        response = requests.get(
            f"{SLSKR_URL}/api/searches/{search_id}",
            headers={"Authorization": f"Bearer {SLSKR_TOKEN}"},
            timeout=10,
        )
        if response.status_code == 404:
            add_log(f"[slskr] GET /api/searches/{search_id} dio 404, probando /api/v0/searches/{search_id}")
            response = requests.get(
                f"{SLSKR_URL}/api/v0/searches/{search_id}",
                headers={"Authorization": f"Bearer {SLSKR_TOKEN}"},
                timeout=10,
            )
        try:
            data = response.json()
            add_log(f"[slskr] GET data (searchId={search_id}): {str(data)[:800]}")
            return jsonify(data)
        except Exception:
            text = response.text
            add_log(f"[slskr] GET {response.status_code}: searchId={search_id}: {text[:300]}")
            return response.text, response.status_code, {"Content-Type": "text/plain"}
    except Exception as e:
        add_log(f"[slskr] Error de conexión: {e}")
        return jsonify({"error": f"Error de conexión: {e}"}), 500


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
            return jsonify({"error": f"slskd {response.status_code}", "status": "error"}), 200
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
    full = os.path.abspath(os.path.join(PREVIEWS_DIR, rel))
    if not full.startswith(os.path.abspath(PREVIEWS_DIR)):
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
    return jsonify({"downloads_dir": current_downloads_dir})


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
        app_config["downloads_dir"] = new_dir
        save_config(app_config)
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
            return jsonify({"error": f"slskd {response.status_code}", "status": "error"}), 200
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
            return jsonify({"error": f"slskd {response.status_code}"}), 200
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
            return jsonify({"error": f"slskd cancel {cancel_resp.status_code}"}), 200
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
        for row in rows:
            f.write(row["search_query"] + "\n")
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
    full = os.path.abspath(os.path.join(base, rel))
    if not full.startswith(os.path.abspath(base)):
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
                    if n.endswith(".preview.mp3") or n.endswith(".processing") or n.endswith(".failed"):
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
    app.run(debug=False, host="127.0.0.1", port=5000)
