"""Self-update against GitHub releases.

The app queries the latest release of the repository, compares it against
``APP_VERSION`` and, when a newer build exists, downloads the replacement
``spotify2soulseek.exe`` and swaps it in place.

Windows note: a running .exe cannot be overwritten, but it *can* be renamed.
The swap therefore renames the running exe to ``<name>.old``, moves the new
file into its place and relaunches it — the same trick ``uv self update``
uses. Leftover ``.old``/``.new`` files are cleaned on next startup.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

import requests

from backend.paths import exe_dir, is_frozen
from backend.version import APP_VERSION

GITHUB_REPO = "rickypcyt/soulseek-spotify2csv-downloader"
LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
EXE_ASSET_NAME = "spotify2soulseek.exe"
_UPDATE_SUFFIXES = (".old", ".new")


def console_print(msg: str) -> None:
    """Write to the real console even when stdout is redirected to the log file."""
    stream = getattr(sys, "__stdout__", None) or sys.stdout
    try:
        stream.write(msg + "\n")
        stream.flush()
    except Exception:
        pass


def parse_version(tag: str) -> tuple[int, ...]:
    """``"v1.2.3"`` -> ``(1, 2, 3)``. Non-numeric suffixes are ignored."""
    m = re.match(r"^v?(\d+(?:\.\d+)*)", tag.strip())
    if not m:
        return (0,)
    return tuple(int(p) for p in m.group(1).split("."))


def is_newer(latest: str, current: str) -> bool:
    """True if ``latest`` is a strictly higher version than ``current``."""
    a, b = parse_version(latest), parse_version(current)
    size = max(len(a), len(b))
    a += (0,) * (size - len(a))
    b += (0,) * (size - len(b))
    return a > b


def check_latest_release(timeout: float = 10.0) -> dict | None:
    """Return info about the newest GitHub release, or ``None`` if unreachable
    or no release has been published yet.

    Keys: ``current``, ``latest``, ``update_available``, ``download_url``,
    ``release_url``.
    """
    try:
        resp = requests.get(
            LATEST_RELEASE_URL,
            timeout=timeout,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"spotify2soulseek/{APP_VERSION}",
            },
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    tag = data.get("tag_name", "")
    download_url = ""
    for asset in data.get("assets", []):
        if asset.get("name") == EXE_ASSET_NAME:
            download_url = asset.get("browser_download_url", "")
            break
    return {
        "current": APP_VERSION,
        "latest": tag[1:] if tag.startswith("v") else tag,
        "update_available": is_newer(tag, APP_VERSION),
        "download_url": download_url,
        "release_url": data.get("html_url", ""),
    }


def download_exe(url: str, dest: Path, prefix: str = "[update] ") -> bool:
    """Stream-download ``url`` to ``dest`` with console progress."""
    try:
        resp = requests.get(
            url,
            stream=True,
            timeout=600,
            headers={"User-Agent": f"spotify2soulseek/{APP_VERSION}"},
        )
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        downloaded = 0
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                fh.write(chunk)
                downloaded += len(chunk)
                if total:
                    console_print(f"\r{prefix}Descargando... {downloaded * 100 // total}%")
                else:
                    console_print(f"\r{prefix}Descargando... {downloaded // 1024} KB")
        console_print("")
        return True
    except Exception as exc:
        console_print(f"{prefix}Error descargando actualización: {exc}")
        try:
            dest.unlink()
        except OSError:
            pass
        return False


def target_exe_path() -> Path:
    """Path of the exe to replace.

    Frozen: the running executable itself.
    Dev: ``dist/spotify2soulseek.exe`` under the repo root, so ``--update``
    also refreshes the build produced by ``start.ps1``.
    """
    if is_frozen():
        return Path(sys.executable).resolve()
    return exe_dir() / "dist" / EXE_ASSET_NAME


def cleanup_stale_files() -> None:
    """Delete leftover ``.old``/``.new`` files from previous updates.

    Called at startup; the previous process has already exited, so its
    renamed exe can be removed now.
    """
    target = target_exe_path()
    for suffix in _UPDATE_SUFFIXES:
        try:
            stale = target.with_name(target.name + suffix)
            if stale.is_file():
                stale.unlink()
        except OSError:
            pass


def swap_running_exe(new_exe: Path) -> Path | None:
    """Replace the running exe with ``new_exe`` via rename. Frozen mode only.

    Returns the path of the renamed previous exe (``<name>.old``), or ``None``
    on failure. The caller is expected to stop other instances, relaunch the
    new exe and exit right after.
    """
    if not is_frozen():
        return None
    running = Path(sys.executable).resolve()
    backup = running.with_name(running.name + ".old")
    try:
        if backup.exists():
            backup.unlink()
    except OSError:
        pass
    try:
        os.replace(running, backup)
        os.replace(new_exe, running)
    except OSError as exc:
        console_print(f"[update] No se pudo reemplazar el ejecutable: {exc}")
        # Best-effort rollback so the old exe keeps working.
        if not running.exists() and backup.exists():
            try:
                os.replace(backup, running)
            except OSError:
                pass
        return None
    return backup


def stop_other_instances(image_name: str) -> None:
    """taskkill every process with ``image_name`` except the current one."""
    if os.name != "nt":
        return
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", image_name, "/FI", f"PID ne {os.getpid()}"],
            capture_output=True,
            check=False,
            timeout=15,
        )
    except Exception:
        pass


def relaunch(exe_path: Path) -> None:
    """Start a detached new instance of the app."""
    creationflags = (
        getattr(subprocess, "DETACHED_PROCESS", 0)
        | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
    subprocess.Popen(
        [str(exe_path)],
        cwd=str(exe_path.parent),
        creationflags=creationflags,
        close_fds=True,
    )


def _message_box(text: str, title: str, flags: int) -> int:
    import ctypes

    MB_SETFOREGROUND = 0x10000  # la app abre un navegador; que el diálogo quede encima
    return ctypes.windll.user32.MessageBoxW(0, text, title, flags | MB_SETFOREGROUND)


def ask_update_dialog(info: dict) -> bool:
    """Ventana nativa de Windows preguntando si instalar la nueva versión.

    Devuelve True solo si el usuario pulsa "Sí". Fuera de Windows devuelve
    False (el aviso por consola sigue funcionando).
    """
    if os.name != "nt":
        return False
    try:
        MB_YESNO, MB_ICONQUESTION, IDYES = 0x4, 0x20, 6
        answer = _message_box(
            f"Hay una nueva versión disponible: v{info['latest']} "
            f"(actual: v{info['current']}).\n\n"
            "¿Descargar e instalar ahora? La aplicación se cerrará y "
            "volverá a abrirse actualizada.",
            "spotify2soulseek — Actualización disponible",
            MB_YESNO | MB_ICONQUESTION,
        )
        return answer == IDYES
    except Exception:
        return False


def show_update_dialog(title: str, text: str, error: bool = False) -> None:
    """Ventana nativa informativa (resultado de la actualización)."""
    if os.name != "nt":
        return
    try:
        icon = 0x10 if error else 0x40  # ICONERROR / ICONINFORMATION
        _message_box(text, title, 0x0 | icon)  # MB_OK
    except Exception:
        pass


def install_release_exe(info: dict) -> Path | None:
    """Descarga el exe del release y lo intercambia por el que está corriendo.

    Devuelve la ruta del exe instalado, o ``None`` si algo falló. El caller
    debe cerrar las demás instancias, relanzar ``relaunch(path)`` y salir
    del proceso actual a continuación.
    """
    console_print(f"[update] Actualizando v{info['current']} -> v{info['latest']}...")
    target = target_exe_path()
    tmp = target.with_name(target.name + ".new")
    if not download_exe(info["download_url"], tmp):
        return None
    if swap_running_exe(tmp) is None:
        return None
    return target


def cli_check_update() -> int:
    """``--check-update``: report whether a newer release exists."""
    info = check_latest_release()
    if info is None:
        console_print("[update] No se pudo consultar GitHub (sin releases o sin conexión).")
        return 1
    if info["update_available"]:
        console_print(
            f"[update] Nueva versión disponible: v{info['latest']} "
            f"(actual: v{info['current']})."
        )
        console_print(f"[update] Ejecuta '{EXE_ASSET_NAME} --update' para instalarla.")
    else:
        console_print(f"[update] Ya estás en la última versión (v{info['current']}).")
    return 0


def cli_self_update() -> int:
    """``--update``: download the newest exe and swap it in place."""
    info = check_latest_release()
    if info is None:
        console_print("[update] No se pudo consultar GitHub (sin releases o sin conexión).")
        return 1
    if not info["update_available"]:
        console_print(f"[update] Ya estás en la última versión (v{info['current']}).")
        return 0
    if not info["download_url"]:
        console_print(
            f"[update] El release {info['latest']} no incluye {EXE_ASSET_NAME}."
        )
        return 1

    if not is_frozen():
        # Dev mode: refresh dist/spotify2soulseek.exe (nothing of ours is
        # running from that file, only possibly a previous packaged build).
        console_print(f"[update] Actualizando v{info['current']} -> v{info['latest']}...")
        target = target_exe_path()
        tmp = target.with_name(target.name + ".new")
        if not download_exe(info["download_url"], tmp):
            return 1
        stop_other_instances(EXE_ASSET_NAME)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(tmp, target)
        except OSError as exc:
            console_print(f"[update] No se pudo escribir {target}: {exc}")
            return 1
        console_print(f"[update] Actualizado a v{info['latest']} en {target}")
        return 0

    target = install_release_exe(info)
    if target is None:
        return 1
    stop_other_instances(target.name)
    time.sleep(0.5)  # dejar que las instancias anteriores liberen el puerto
    relaunch(target)
    console_print(f"[update] Actualizado a v{info['latest']}. Reiniciando...")
    return 0
