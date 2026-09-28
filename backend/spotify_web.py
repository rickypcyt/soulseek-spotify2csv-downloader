"""Entry point for the local Spotify → Soulseek web service.

Run with ``python -m backend.spotify_web``. All routing and service logic
lives in :mod:`backend.app` and the ``backend.routes`` package; this module
only constructs the app and starts the HTTP server.
"""

from __future__ import annotations

import atexit
import os
import sys
import threading
import time
import webbrowser

import requests

from backend.app import create_app
from backend.bootstrap import ensure_slskd
from backend.paths import data_dir, is_frozen
from backend.updater import (
    ask_update_dialog,
    check_latest_release,
    cleanup_stale_files,
    cli_check_update,
    cli_self_update,
    console_print,
    install_release_exe,
    relaunch,
    show_update_dialog,
    stop_other_instances,
)
from backend.version import APP_VERSION

_CLI_FLAGS = ("--version", "--check-update", "--update")


def _setup_logging() -> None:
    if not is_frozen():
        return
    # Los flags de terminal deben imprimir en la consola real, no en el log.
    if any(flag in sys.argv for flag in _CLI_FLAGS):
        return
    try:
        log_path = data_dir() / "spotify2soulseek.log"
        log_file = open(log_path, "a", encoding="utf-8")
        console = sys.stdout
        log_file.write(
            f"\n{'=' * 60}\n"
            f"  nueva sesión · {time.strftime('%Y-%m-%d %H:%M:%S')} · v{APP_VERSION}\n"
            f"{'=' * 60}\n"
        )

        class _TeeStream:
            """Escribe a la vez en la consola y en el archivo de log."""

            def write(self, msg):
                for stream in (console, log_file):
                    try:
                        stream.write(msg)
                        stream.flush()
                    except Exception:
                        pass

            def flush(self):
                for stream in (console, log_file):
                    try:
                        stream.flush()
                    except Exception:
                        pass

        sys.stdout = _TeeStream()
        sys.stderr = sys.stdout
    except Exception:
        pass


_setup_logging()

# Re-exported for backwards compatibility with existing imports/tests.
from backend.fs_utils import safe_dirname as _safe_dirname  # noqa: F401

app, state = create_app()


def _check_updates_background() -> None:
    """Consulta GitHub en segundo plano y, si hay nueva versión, ofrece instalarla.

    En el exe empaquetado muestra una ventana de Windows (Sí/No). Si el
    usuario la rechaza, la versión queda registrada como ignorada y no se
    vuelve a preguntar por ella. La respuesta afirmativa descarga el exe,
    lo intercambia y reinicia la aplicación.
    """

    def _run() -> None:
        info = check_latest_release(timeout=8)
        if not info or not info["update_available"]:
            return
        console_print(
            f"[update] Nueva versión disponible: v{info['latest']} "
            f"(actual: v{info['current']}). "
            f"Ejecuta 'spotify2soulseek.exe --update' para instalarla."
        )
        if not is_frozen():
            return
        if state.config_store.get().get("skipped_update_version") == info["latest"]:
            return
        if not ask_update_dialog(info):
            state.config_store.update({"skipped_update_version": info["latest"]})
            return
        target = install_release_exe(info)
        if target is None:
            show_update_dialog(
                "spotify2soulseek — Error de actualización",
                "No se pudo instalar la nueva versión. "
                "Inténtalo de nuevo con 'spotify2soulseek.exe --update'.",
                error=True,
            )
            return
        try:
            state.slskd.stop()
        except Exception:
            pass
        stop_other_instances(target.name)
        time.sleep(0.5)  # dejar que libere el puerto antes de relanzar
        relaunch(target)
        os._exit(0)

    threading.Thread(target=_run, daemon=True).start()


def _print_welcome(url: str) -> None:
    bar = "=" * 58
    print()
    print(bar)
    print(f"   spotify2soulseek  ·  v{APP_VERSION}")
    print("   Tus playlists de Spotify, descargadas desde Soulseek")
    print(bar)
    print()
    print(f"   La interfaz se abrirá en tu navegador:  {url}")
    print()
    print("   · Deja esta ventana abierta mientras usas la aplicación.")
    print("   · Al cerrarla, la app se detiene por completo.")
    print("   · Comandos:  --version · --check-update · --update")
    print()


def _open_browser_delayed(url: str, delay: float = 2.0) -> None:
    """Open the browser after a short delay (lets Flask start listening)."""

    def _open() -> None:
        import time

        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=_open, daemon=True).start()


def main() -> None:
    if "--version" in sys.argv:
        console_print(APP_VERSION)
        sys.exit(0)
    if "--check-update" in sys.argv:
        sys.exit(cli_check_update())
    if "--update" in sys.argv:
        sys.exit(cli_self_update())

    cleanup_stale_files()
    if "--no-update-check" not in sys.argv and os.getenv("SOULSEEK_NO_UPDATE_CHECK") != "1":
        _check_updates_background()

    frozen = getattr(sys, "frozen", False)
    # El modo dev (reloader/debugger) no tiene sentido dentro del exe empaquetado;
    # se ignora aunque SOULSEEK_DEV quedara en el entorno de la terminal.
    dev_mode = os.getenv("SOULSEEK_DEV") == "1" and not frozen
    host = os.getenv("SOULSEEK_HOST", "127.0.0.1")
    port = int(os.getenv("SOULSEEK_PORT", "5000"))
    url = f"http://{host}:{port}"

    if not dev_mode:
        _print_welcome(url)

    print("[startup] Comprobando slskd (el motor de Soulseek)...")
    slskd_path = ensure_slskd(state.config_store)
    if slskd_path:
        print(f"[startup] slskd listo: {slskd_path}")
    else:
        print("[startup] slskd no disponible ahora mismo; podrás configurarlo desde la interfaz.")

    print("[startup] Iniciando el servidor local...")
    state.slskd.start_from_config()

    def _run_server() -> None:
        app.run(debug=False, use_reloader=False, host=host, port=port)

    if frozen and not dev_mode:
        server = threading.Thread(target=_run_server, daemon=True)
        server.start()

        for _ in range(80):
            try:
                requests.get(url, timeout=0.25)
                break
            except Exception:
                time.sleep(0.25)

        atexit.register(state.slskd.stop)
        try:
            webbrowser.open(url)
            print(f"[startup] Todo listo. Navegador abierto en {url}")
            print("[startup] Puedes minimizar esta ventana; la app sigue funcionando.")
        except Exception:
            print(f"[startup] Abre manualmente: {url}")
        try:
            # Mantener el proceso vivo: el servidor corre en el hilo daemon.
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[salida] Cerrando spotify2soulseek...")
            return

    if not dev_mode:
        print(f"[startup] Abriendo navegador en {url} ...")
        _open_browser_delayed(url)
    else:
        print(f"[startup] Modo desarrollo: abre {url} manualmente")

    try:
        app.run(debug=dev_mode, use_reloader=dev_mode, host=host, port=port)
    except KeyboardInterrupt:
        print("\n[salida] Cerrando spotify2soulseek...")


if __name__ == "__main__":
    main()
