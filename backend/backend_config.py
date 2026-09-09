import os
from dataclasses import dataclass
from pathlib import Path


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
        # Keep all project-relative paths anchored at the repository root, not backend/.
        root = script_dir or Path(__file__).resolve().parent.parent
        default_downloads = Path.home() / "Music" / "Soulseek Downloads"
        downloads_dir = Path(os.getenv("SLSKD_DOWNLOADS_DIR") or default_downloads)
        return cls(
            script_dir=root,
            dist_dir=root / "frontend" / "dist",
            run_script=root / "run.ps1",
            csv_output=root / "web_output.csv",
            playlist_name_file=root / "web_playlist_name.txt",
            previews_dir=downloads_dir / "temp",
            downloads_dir=downloads_dir,
            config_file=root / "web_config.json",
            logs_file=root / "web_logs.json",
            slskd_url=os.getenv("SLSKD_URL", "http://127.0.0.1:5030"),
            slskd_key=os.getenv("SLSKD_API_KEY", ""),
        )
