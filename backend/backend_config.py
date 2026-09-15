from dataclasses import dataclass
from pathlib import Path

from backend.paths import app_root, data_dir, frontend_dist


@dataclass(frozen=True)
class BackendSettings:
    script_dir: Path
    dist_dir: Path
    run_script: Path
    csv_output: Path
    playlist_name_file: Path
    previews_dir: Path
    downloads_dir: Path
    config_file: Path
    logs_file: Path
    slskd_url: str
    slskd_key: str

    @property
    def use_slskd(self) -> bool:
        return bool(self.slskd_key)

    @classmethod
    def from_environment(cls, script_dir: Path | None = None) -> "BackendSettings":
        if script_dir is not None:
            root = Path(script_dir)
            dist = root / "frontend" / "dist"
            data = root / "data"
        else:
            root = app_root()
            dist = frontend_dist()
            data = data_dir()
        default_downloads = Path.home() / "Music" / "Soulseek Downloads"
        downloads_dir = default_downloads
        return cls(
            script_dir=root,
            dist_dir=dist,
            run_script=root / "start.ps1",
            csv_output=data / "web_output.csv",
            playlist_name_file=data / "web_playlist_name.txt",
            previews_dir=downloads_dir / "temp",
            downloads_dir=downloads_dir,
            config_file=data / "web_config.json",
            logs_file=data / "web_logs.json",
            slskd_url="http://127.0.0.1:5030",
            slskd_key="",
        )
