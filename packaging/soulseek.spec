# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Spotify → Soulseek desktop app.

Build with:  pyinstaller packaging/soulseek.spec
Or via:      .\start.ps1
"""

import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

# SPEC is injected by PyInstaller: path of this spec file.
# The repo root is one level up from packaging/.
try:
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(SPEC)))
except NameError:
    ROOT = os.getcwd()

datas = []
binaries = []
hiddenimports = []

# --- Third-party packages with dynamic imports / plugins ---
for pkg in ("keyring", "spotipy", "mutagen", "requests"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# Flask and its dependencies
for pkg in ("flask", "jinja2", "werkzeug", "click", "itsdangerous", "markupsafe"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# Ensure all backend submodules are collected
hiddenimports += collect_submodules("backend")

# --- slskd binary (bundled so the .exe works offline) ---
_vendor_slskd = os.path.join(ROOT, "vendor", "slskd")
if os.path.isdir(_vendor_slskd):
    datas += [(_vendor_slskd, "vendor/slskd")]

# --- Frontend build output (read-only resource) ---
datas += [(os.path.join(ROOT, "frontend", "dist"), "frontend/dist")]

a = Analysis(
    [os.path.join(ROOT, "backend", "spotify_web.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["pytest", "ruff", "tests"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="spotify2soulseek",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
