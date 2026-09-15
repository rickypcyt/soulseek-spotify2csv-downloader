"""slskd HTTP client, process supervisor and transfer/search tracking.

All communication with the local slskd daemon goes through this module. It
also owns the in-process state for active searches and pending downloads that
previously lived as loose module-level globals in ``spotify_web``.
"""

from __future__ import annotations

import glob
import os
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

import requests

from backend.database import complete_download, set_playlist_track_status
from backend.fs_utils import safe_dirname
from backend.library_service import write_audio_metadata

if TYPE_CHECKING:
    from backend.runtime import RuntimeState

MAX_SEARCH_QUERY_LENGTH = 200
MAX_ACTIVE_SEARCHES = 50
MAX_SEARCH_LIFETIME_SECONDS = 120
SEARCH_QUEUE_TIMEOUT_SECONDS = 120
_TERMINAL_SEARCH_STATES = {"completed", "complete", "finished", "failed", "error", "cancelled", "canceled"}
_COMPLETED_TRANSFER_STATES = {"completed", "complete", "succeeded", "finished"}


class SlskdClient:
    """Wraps the slskd REST API and the optional local process."""

    def __init__(self, state: RuntimeState) -> None:
        self.state = state
        config = state.config_store.get()
        self.url: str = config.get("slskd_url") or state.settings.slskd_url
        self.key: str = state.config_store.get_secret("slskd_api_key")
        self.process: subprocess.Popen | None = None
        # Active search tracking (replaces ACTIVE_SEARCH_IDS / ACTIVE_SEARCH_STARTED).
        self.active_search_ids: set[str] = set()
        self.active_search_started: dict[str, float] = {}
        # Cola de búsquedas: las peticiones esperan a que se libere un slot.
        self._search_slot = threading.Condition()
        # Pending download tracking (replaces PENDING_DOWNLOADS / *_FOLDERS / *_METADATA).
        self.pending_folders: dict[tuple[str, str], str | None] = {}
        self.pending_metadata: dict[tuple[str, str], dict[str, str]] = {}

    # ------------------------------------------------------------------
    # Configuration / process management
    # ------------------------------------------------------------------
    def headers(self) -> dict[str, str]:
        return {"X-API-Key": self.key, "Content-Type": "application/json"}

    def refresh_config(self) -> None:
        """Re-read slskd URL/key from the config store (after a config update)."""
        config = self.state.config_store.get()
        self.url = config.get("slskd_url") or self.state.settings.slskd_url
        self.key = self.state.config_store.get_secret("slskd_api_key")

    def _ensure_api_key(self) -> str:
        if self.key:
            return self.key
        generated = secrets.token_hex(32)
        self.state.config_store.update({"slskd_api_key": generated})
        self.key = generated
        self.state.logs.add("[slskd] API key generada y guardada en el almacén seguro")
        return self.key

    def start_from_config(self) -> bool:
        path = self.state.config_store.get().get("slskd_path", "")
        if not path or not os.path.isfile(path):
            return False
        if self.process and self.process.poll() is None:
            return True
        previews_dir = self.state.previews_dir
        os.makedirs(previews_dir, exist_ok=True)
        incomplete_dir = os.path.join(previews_dir, ".incomplete")
        webroot_dir = os.path.join(os.path.dirname(path), "wwwroot")
        os.makedirs(incomplete_dir, exist_ok=True)
        os.makedirs(webroot_dir, exist_ok=True)
        api_key = self._ensure_api_key()
        environment = os.environ.copy()
        environment.update(
            {
                "SLSKD_SLSK_USERNAME": self.state.config_store.get_secret("soulseek_username"),
                "SLSKD_SLSK_PASSWORD": self.state.config_store.get_secret("soulseek_password"),
                "SLSKD__WEB__HTTPS__DISABLED": "true",
                "SLSKD__WEB__CONTENT_PATH": webroot_dir,
                "SLSKD_NO_HTTPS": "true",
                "SLSKD__WEB__AUTHENTICATION__API_KEYS__SOULSEEK_WEB__KEY": api_key,
                "SLSKD__WEB__AUTHENTICATION__API_KEYS__SOULSEEK_WEB__ROLE": "administrator",
                "SLSKD__WEB__AUTHENTICATION__API_KEYS__SOULSEEK_WEB__CIDR": "127.0.0.1/32,::1/128",
            }
        )
        self.process = subprocess.Popen(
            [path, "--headless", "--downloads", previews_dir, "--incomplete", incomplete_dir],
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.state.logs.add("[slskd] Servicio iniciado desde la configuración local")
        return True

    def ensure_available(self, wait_seconds: float = 8) -> bool:
        """Start the configured slskd and wait briefly for its HTTP API to listen."""
        try:
            started_or_running = self.start_from_config()
        except Exception as exc:
            self.state.logs.add(f"[slskd] No se pudo iniciar: {exc}")
            return False

        deadline = time.monotonic() + wait_seconds
        while time.monotonic() < deadline:
            try:
                # Any HTTP response proves the service is listening; auth/status is
                # handled by the actual API request afterward.
                requests.get(self.url, headers=self.headers(), timeout=1)
                return True
            except requests.RequestException:
                if started_or_running and self.process and self.process.poll() is not None:
                    self.state.logs.add(f"[slskd] El proceso terminó durante el arranque (código {self.process.returncode})")
                    break
                time.sleep(0.25)
        return False

    def reachable(self) -> bool:
        try:
            requests.get(self.url, headers=self.headers(), timeout=1)
            return True
        except requests.RequestException:
            return False

    def unavailable_message(self) -> str:
        configured_path = self.state.config_store.get().get("slskd_path", "")
        if configured_path:
            return (
                f"No se pudo conectar con slskd en {self.url}. "
                "Verifica que slskd esté iniciado y que la URL/API key sean correctas."
            )
        return (
            f"slskd no está disponible en {self.url}. "
            "Configura la ruta de slskd.exe en 'Configuración local' o inicia slskd manualmente."
        )

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------
    def _prune_active_searches(self) -> None:
        cutoff = time.monotonic() - MAX_SEARCH_LIFETIME_SECONDS
        expired = [search_id for search_id, started in self.active_search_started.items() if started < cutoff]
        for search_id in expired:
            self.active_search_started.pop(search_id, None)
            self.active_search_ids.discard(search_id)
        if expired:
            with self._search_slot:
                self._search_slot.notify_all()

    @staticmethod
    def normalize_search(data: dict[str, Any]) -> dict[str, Any]:
        """Convert a slskd search response into the shape the frontend expects."""
        flat = []
        responses = data.get("responses", [])
        if isinstance(responses, dict):
            responses = responses.get("responses", [])
        for resp in responses if isinstance(responses, list) else []:
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
        data["status"] = "completed" if data.get("isComplete") else data.get("state") or data.get("status")
        data["responseCount"] = data.get("responseCount", 0)
        return data

    def create_search(self, query: str) -> tuple[dict[str, Any], int]:
        """POST a new search. Returns (json_body, status_code).

        Si hay demasiadas búsquedas activas, espera a que se libere un slot
        en vez de devolver un error 429.
        """
        self.state.logs.add(f"[slskd] POST {self.url}/api/v0/searches")
        self.state.logs.add(f"[slskd] searchText='{query}'")
        if not self.ensure_available():
            message = self.unavailable_message()
            self.state.logs.add(f"[slskd] {message}")
            return {"error": message, "status": "unavailable"}, 503
        # Cola de búsquedas: esperar a que haya un slot libre.
        self._prune_active_searches()
        with self._search_slot:
            while len(self.active_search_ids) >= MAX_ACTIVE_SEARCHES:
                if not self._search_slot.wait(timeout=SEARCH_QUEUE_TIMEOUT_SECONDS):
                    self.state.logs.add("[slskd] Tiempo de espera agotado en la cola de búsquedas")
                    return {"error": "Tiempo de espera agotado esperando un slot de búsqueda"}, 503
        search_id = str(uuid.uuid4())
        try:
            response = requests.post(
                f"{self.url}/api/v0/searches",
                headers=self.headers(),
                json={"id": search_id, "searchText": query, "searchTimeout": 30000},
                timeout=10,
            )
        except requests.RequestException as exc:
            self.state.logs.add(f"[slskd] Error de conexión: {exc}")
            return {"error": f"Error de conexión: {exc}"}, 500
        try:
            data = response.json()
            self.state.logs.add(f"[slskd] {response.status_code}: {data}")
            if not response.ok:
                return {"error": f"Error {response.status_code}", "details": data}, response.status_code
            data = self.normalize_search(data)
            self.active_search_ids.add(data["searchId"])
            self.active_search_started[data["searchId"]] = time.monotonic()
            return {
                "searchId": data["searchId"],
                "query": data["query"],
                "resultsCount": data["resultsCount"],
            }, 200
        except Exception:
            text = response.text
            self.state.logs.add(f"[slskd] {response.status_code}: {text[:500]}")
            return {"error": f"Error {response.status_code}: {text[:500]}"}, response.status_code

    def cancel_search(self, search_id: str) -> tuple[dict[str, Any], int]:
        self.active_search_ids.discard(search_id)
        self.active_search_started.pop(search_id, None)
        with self._search_slot:
            self._search_slot.notify()
        try:
            response = requests.delete(
                f"{self.url}/api/v0/searches/{search_id}",
                headers=self.headers(),
                timeout=10,
            )
            if not response.ok and response.status_code not in {404, 405}:
                return {"error": f"slskd {response.status_code}"}, response.status_code
        except Exception as exc:
            self.state.logs.add(f"[slskd] DELETE search error: {exc}")
        return {"ok": True, "cancelled": True}, 200

    def get_search(self, search_id: str) -> tuple[dict[str, Any], int]:
        try:
            state_resp = requests.get(
                f"{self.url}/api/v0/searches/{search_id}",
                headers=self.headers(),
                params={"includeResponses": "true"},
                timeout=10,
            )
            if not state_resp.ok:
                self.state.logs.add(f"[slskd] GET state {state_resp.status_code}: searchId={search_id}")
                return {"error": f"slskd {state_resp.status_code}", "status": "error"}, state_resp.status_code
            data = state_resp.json()
            if not data.get("responses"):
                try:
                    resp = requests.get(
                        f"{self.url}/api/v0/searches/{search_id}/responses",
                        headers=self.headers(),
                        timeout=10,
                    )
                    if resp.ok:
                        response_data = resp.json()
                        data["responses"] = (
                            response_data.get("responses", [])
                            if isinstance(response_data, dict)
                            else response_data
                        )
                except Exception as e:
                    self.state.logs.add(f"[slskd] GET responses error: {e}")
            data = self.normalize_search(data)
            status = str(data.get("status") or data.get("state") or "").lower()
            if status in _TERMINAL_SEARCH_STATES:
                self.active_search_ids.discard(search_id)
                self.active_search_started.pop(search_id, None)
                with self._search_slot:
                    self._search_slot.notify()
            self.state.logs.add(f"[slskd] GET data (searchId={search_id}): resultados={data['resultsCount']}")
            return data, 200
        except Exception as e:
            self.state.logs.add(f"[slskd] Error de conexión: {e}")
            return {"error": f"Error de conexión: {e}", "status": "error"}, 200

    def user_status(self, username: str) -> str:
        """Return a Soulseek user's presence as Online, Away, Offline or Unknown."""
        try:
            response = requests.get(
                f"{self.url}/api/v0/users/{quote(username, safe='')}/status",
                headers=self.headers(),
                timeout=5,
            )
            if not response.ok:
                return "Unknown"
            data = response.json()
            presence = data.get("presence") if isinstance(data, dict) else None
            normalized = str(presence or "").strip().capitalize()
            return normalized if normalized in {"Online", "Away", "Offline"} else "Unknown"
        except (requests.RequestException, ValueError):
            return "Unknown"

    # ------------------------------------------------------------------
    # Transfers (downloads / previews / cancel)
    # ------------------------------------------------------------------
    @staticmethod
    def classify_transfer_error(response: requests.Response) -> dict[str, str]:
        """Map slskd transfer errors to stable UI states."""
        try:
            payload = response.json()
        except ValueError:
            payload = {}

        message = ""
        if isinstance(payload, dict):
            for key in ("error", "message", "detail", "title"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    message = value.strip()
                    break
        if not message:
            message = response.text.strip()

        normalized = message.lower()
        if any(phrase in normalized for phrase in (
            "appears to be offline",
            "user is offline",
            "user offline",
            "peer is offline",
            "peer offline",
            "not connected",
        )):
            return {
                "status": "offline",
                "error": "El usuario de Soulseek está desconectado",
            }

        if any(phrase in normalized for phrase in (
            "user not found",
            "unable to connect to user",
            "cannot connect to user",
            "unavailable",
        )):
            return {
                "status": "unavailable",
                "error": "El usuario de Soulseek no está disponible",
            }

        return {
            "status": "error",
            "error": f"slskd {response.status_code}",
        }

    def enqueue_transfer(
        self, username: str, filename: str, size: int, label: str = "download"
    ) -> tuple[dict[str, Any], int]:
        """Enqueue a transfer for ``username``. Returns (json_body, status).

        ``label`` only affects log lines ("download" vs "preview").
        """
        self.state.logs.add(f"[slskd] {label} enqueue user={username} file={filename}")
        try:
            response = requests.post(
                f"{self.url}/api/v0/transfers/downloads/{quote(username, safe='')}",
                headers=self.headers(),
                json=[{"filename": filename, "size": size}],
                timeout=10,
            )
        except Exception as e:
            self.state.logs.add(f"[slskd] {label} enqueue error: {e}")
            return {"error": str(e), "status": "error"}, 200
        self.state.logs.add(f"[slskd] {label} enqueue {response.status_code}: {response.text[:300]}")
        if not response.ok:
            return self.classify_transfer_error(response), response.status_code
        return {"ok": True}, 200

    def _find_transfer(self, username: str, filename: str) -> dict[str, Any]:
        """Return the current transfer state and progress details."""
        response = requests.get(
            f"{self.url}/api/v0/transfers/downloads/{quote(username, safe='')}",
            headers=self.headers(),
            timeout=10,
        )
        if not response.ok:
            return {"state": "Unknown", "percentComplete": 0}
        data = response.json()
        details: dict[str, Any] = {"state": "Unknown", "percentComplete": 0}
        for directory in data.get("directories", []):
            for file_data in directory.get("files", []):
                if file_data.get("filename") == filename or (file_data.get("filename") or "").endswith(filename):
                    for key in ("state", "percentComplete", "bytesRemaining", "bytesTransferred", "averageSpeed", "currentSpeed"):
                        if key in file_data:
                            details[key] = file_data[key]
                    break
            if details["state"] != "Unknown":
                break
        return details

    def preview_status(self, username: str, filename: str) -> dict[str, Any]:
        transfer = self._find_transfer(username, filename)
        target_state = transfer.get("state", "Unknown")
        base = os.path.basename(filename.replace("\\", "/").replace("/", os.sep))
        matches = glob.glob(os.path.join(self.state.previews_dir, "**", glob.escape(base)), recursive=True)
        if matches:
            latest = max(matches, key=os.path.getmtime)
            rel = os.path.relpath(latest, self.state.previews_dir).replace("\\", "/")
            return {**transfer, "state": "Completed", "path": rel, "percentComplete": 100}
        return transfer

    def download_status(
        self,
        username: str,
        filename: str,
        requested_folder: str,
        playlist_name: str,
    ) -> dict[str, Any]:
        transfer = self._find_transfer(username, filename)
        target_state = transfer.get("state", "Unknown")
        if str(target_state).lower() not in _COMPLETED_TRANSFER_STATES:
            return transfer

        base = os.path.basename(filename.replace("\\", "/").replace("/", os.sep))
        # Buscar en temporales y mover el archivo terminado a la carpeta final.
        matches = glob.glob(os.path.join(self.state.previews_dir, "**", glob.escape(base)), recursive=True)
        if not matches:
            # Ya pudo haber sido movido a la carpeta final.
            matches = glob.glob(os.path.join(self.state.current_downloads_dir, "**", glob.escape(base)), recursive=True)
        if not matches:
            return transfer

        latest = max(matches, key=os.path.getmtime)
        latest_abs = os.path.abspath(latest)
        previews_abs = os.path.abspath(self.state.previews_dir)
        download_key = (username, filename)
        pending_folder = self.pending_folders.get(download_key)
        if pending_folder is not None:
            folder_name = requested_folder or pending_folder
        else:
            folder_name = requested_folder or playlist_name
        is_in_previews = os.path.commonpath([latest_abs, previews_abs]) == previews_abs
        if is_in_previews and folder_name:
            target_dir = os.path.join(self.state.current_downloads_dir, safe_dirname(folder_name))
            self.state.logs.add(f"[library] destino de descarga: {target_dir}")
            os.makedirs(target_dir, exist_ok=True)
            dest = os.path.join(target_dir, base)
            try:
                if os.path.abspath(dest) == latest_abs:
                    pass
                elif os.path.exists(dest):
                    os.remove(latest)
                    self.state.logs.add(f"[slskd] temporal eliminado; ya existía {dest}")
                else:
                    shutil.move(latest, dest)
                    self.state.logs.add(f"[slskd] download moved to {dest}")
                latest = dest
            except Exception as e:
                self.state.logs.add(f"[slskd] download move error: {e}")
                return {"state": "error", "error": str(e), "saved": False}
        metadata = self.pending_metadata.get(download_key, {})
        track_name = str(metadata.get("track_name", "")).strip()
        artists = str(metadata.get("artists", "")).strip()
        track_key = metadata.get("track_key")
        if track_key and track_name and artists and latest:
            try:
                folder = os.path.dirname(latest)
                base = os.path.basename(latest)
                ext = os.path.splitext(base)[1]
                safe_name = safe_dirname(f"{track_name} - {artists}")[:120] or "sin_nombre"
                new_base = f"{safe_name}{ext}"
                if new_base != base:
                    new_path = os.path.join(folder, new_base)
                    n = 1
                    while os.path.exists(new_path):
                        new_base = f"{safe_name} ({n}){ext}"
                        new_path = os.path.join(folder, new_base)
                        n += 1
                    os.rename(latest, new_path)
                    latest = new_path
                    self.state.logs.add(f"[slskd] archivo renombrado: {new_base}")
                    write_audio_metadata(latest, track_name, artists, metadata.get("album", ""))
            except Exception as e:
                self.state.logs.add(f"[slskd] error al renombrar/retaggear: {e}")

        rel = os.path.relpath(latest, self.state.current_downloads_dir).replace("\\", "/")
        metadata = self.pending_metadata.pop(download_key, {})
        download_id = metadata.get("download_id")
        if download_id:
            complete_download(download_id, rel)
        track_key = metadata.get("track_key")
        if track_key:
            self.state.library.register_track(
                track_key,
                metadata.get("track_name"),
                metadata.get("artists"),
                rel,
                metadata.get("cover_url", ""),
            )
            playlist_key = metadata.get("playlist_key")
            if playlist_key:
                try:
                    set_playlist_track_status(playlist_key, track_key, downloaded=True)
                except Exception as exc:
                    self.state.logs.add(f"[playlist] Error al marcar descarga: {exc}")
        self.pending_folders.pop(download_key, None)
        return {"state": "Completed", "path": rel, "saved": True, "percentComplete": 100}

    def cancel_transfer(self, username: str, filename: str) -> tuple[dict[str, Any], int]:
        try:
            response = requests.get(
                f"{self.url}/api/v0/transfers/downloads/{quote(username, safe='')}",
                headers=self.headers(),
                timeout=10,
            )
            if not response.ok:
                return {"error": f"slskd {response.status_code}"}, response.status_code
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
                return {"ok": True, "cancelled": False}, 200
            cancel_url = f"{self.url}/api/v0/transfers/downloads/{quote(username, safe='')}/{quote(str(transfer_id), safe='')}?remove=true"
            cancel_resp = requests.delete(cancel_url, headers=self.headers(), timeout=10)
            self.state.logs.add(f"[slskd] cancel {username}/{transfer_id}: {cancel_resp.status_code}")
            if not cancel_resp.ok:
                return {"error": f"slskd cancel {cancel_resp.status_code}"}, cancel_resp.status_code
            return {"ok": True, "cancelled": True}, 200
        except Exception as e:
            self.state.logs.add(f"[slskd] cancel error: {e}")
            return {"error": str(e)}, 200

    def active_transfers(self) -> list[dict[str, Any]]:
        """List non-terminal downloads for the diagnostics endpoint."""
        transfers: list[dict[str, Any]] = []
        try:
            r = requests.get(
                f"{self.url}/api/v0/transfers/downloads",
                headers=self.headers(),
                timeout=10,
            )
            if not r.ok:
                return transfers
            data = r.json()
            entries = data if isinstance(data, list) else data.get("downloads", [])
            terminal_states = {"completed", "succeeded", "complete", "cancelled", "canceled", "failed", "error"}
            for entry in entries:
                username = entry.get("username")
                for d in entry.get("directories", []):
                    for f in d.get("files", []):
                        state = f.get("state") or "Unknown"
                        state_parts = {part.strip().lower() for part in str(state).split(",")}
                        if state_parts & terminal_states:
                            continue
                        transfers.append({
                            "username": username,
                            "filename": f.get("filename"),
                            "state": state,
                            "percentComplete": f.get("percentComplete", 0),
                        })
        except Exception as e:
            self.state.logs.add(f"[diagnostics] error slskd: {e}")
        return transfers
