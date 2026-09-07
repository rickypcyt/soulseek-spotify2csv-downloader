import json
import os
from pathlib import Path
from typing import Any

try:
    import keyring
except ImportError:  # pragma: no cover - se instala en el entorno de la aplicación
    keyring = None


SERVICE_NAME = "spotify-soulseek"
SECRET_NAMES = {
    "spotify_client_secret": "SPOTIPY_CLIENT_SECRET",
    "slskd_api_key": "SLSKD_API_KEY",
    "soulseek_username": "SLSK_USERNAME",
    "soulseek_password": "SLSK_PASSWORD",
}


class LocalConfigStore:
    """Stores normal settings in JSON and secrets in the OS credential vault."""

    def __init__(self, config_path: Path):
        self.config_path = Path(config_path)

    def _read_public(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            with self.config_path.open(encoding="utf-8") as handle:
                data = json.load(handle)
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write_public(self, data: dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.config_path.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        temporary.replace(self.config_path)

    def _get_secret(self, name: str) -> str:
        if keyring is not None:
            try:
                value = keyring.get_password(SERVICE_NAME, name)
                if value:
                    return value
            except Exception:
                pass
        return os.getenv(SECRET_NAMES.get(name, name.upper()), "")

    def _set_secret(self, name: str, value: str) -> None:
        if keyring is None:
            raise RuntimeError("No está disponible el almacén seguro del sistema.")
        keyring.set_password(SERVICE_NAME, name, value)

    def get(self) -> dict[str, Any]:
        public = self._read_public()
        result = {
            "spotify_client_id": public.get("spotify_client_id", os.getenv("SPOTIPY_CLIENT_ID", "")),
            "spotify_redirect_uri": public.get(
                "spotify_redirect_uri",
                os.getenv("SPOTIPY_REDIRECT_URI", "http://127.0.0.1:8080/callback"),
            ),
            "provider": "slskd",
            "slskd_url": public.get("slskd_url", os.getenv("SLSKD_URL", "http://127.0.0.1:5030")),
            "soulseek_username": public.get("soulseek_username") or self._get_secret("soulseek_username") or os.getenv("SLSK_USERNAME", ""),
            "downloads_dir": public.get("downloads_dir", ""),
            "slskd_path": public.get("slskd_path", os.getenv("SLSKD_PATH", "")),
        }
        for name in SECRET_NAMES:
            result[f"{name}_configured"] = bool(self._get_secret(name))
        return result

    def get_secret(self, name: str) -> str:
        if name not in SECRET_NAMES:
            raise ValueError(f"Secreto no soportado: {name}")
        return self._get_secret(name)

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        public = self._read_public()
        public_keys = {
            "spotify_client_id",
            "spotify_redirect_uri",
            "slskd_url",
            "soulseek_username",
            "downloads_dir",
            "slskd_path",
        }
        for key in public_keys:
            if key in values and values[key] is not None:
                public[key] = str(values[key]).strip()
        self._write_public(public)

        for name in SECRET_NAMES:
            if name in values and values[name] is not None:
                self._set_secret(name, str(values[name]))
        return self.get()
