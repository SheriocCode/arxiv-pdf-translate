#!/usr/bin/env python3
"""Local companion server for the Arxiv PDF Translate extension.

The browser extension cannot execute local programs, so this small HTTP
service runs on 127.0.0.1. It accepts a raw PDF upload, runs the bundled
translation engine (``engine/``), and serves the generated PDF back to the
extension.

Endpoints
---------
GET    /health                     service + engine availability probe
POST   /jobs?<params>              upload a PDF (raw body), start a job
GET    /jobs/<id>                  poll job status / progress / log tail
GET    /jobs/<id>/result           download the translated PDF
DELETE /jobs/<id>                  cancel and clean up a job
POST   /translate?<params>         synchronous one-shot translation

Only the Python standard library is required; the engine ships with the
project under ``engine/``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote, unquote

BRIDGE_VERSION = "0.2.0"
APP_VERSION = "0.5.0"
UPDATE_MANIFEST_URL_DEFAULT = (
    "https://raw.githubusercontent.com/SheriocCode/arxiv-pdf-translate/main/update.json"
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

WEB_DIR = os.path.join(HERE, "web")
ICONS_DIR = os.path.join(ROOT, "icons")
LOG_FILE_PATH = os.path.join(HERE, "server.log")

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "BrowserPDFTranslate"
SHORTCUT_NAME = "Arxiv PDF Translate.lnk"
LAUNCHER_NAMES = ("ArxivPdfTranslate.exe",)

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 18760,
    "engine_path": "",
    "service": "openai",
    "openai_base_url": "https://api.deepseek.com",
    "openai_api_key": "",
    "openai_model": "deepseek-flash",
    "source_lang": "en",
    "target_lang": "zh-CN",
    "output_variant": "dual",
    "threads": 4,
    "use_babeldoc": False,
    "extra_args": "",
    "timeout": 3600,
    "keep_temp": False,
    "verbose": False,
    "update_url": UPDATE_MANIFEST_URL_DEFAULT,
}

ENV_OVERRIDES = {
    "ENGINE_PATH": "engine_path",
    "ENGINE_HOST": "host",
    "ENGINE_PORT": "port",
    "ENGINE_SERVICE": "service",
    "OPENAI_BASE_URL": "openai_base_url",
    "OPENAI_API_KEY": "openai_api_key",
    "OPENAI_MODEL": "openai_model",
    "ENGINE_TIMEOUT": "timeout",
}

VARIANT_SUFFIX = {"dual": "dual", "mono": "mono"}

_jobs = {}
_jobs_lock = threading.Lock()
_config = dict(DEFAULT_CONFIG)
_config_path = None
_verbose = False

WRITABLE_CONFIG = (
    "service", "openai_base_url", "openai_api_key", "openai_model",
    "engine_path", "use_babeldoc", "extra_args", "timeout",
    "source_lang", "target_lang", "output_variant", "threads",
    "update_url",
)


LOG_LEVELS = ("DEBUG", "INFO", "SUCCESS", "WARN", "ERROR")
LOG_CATEGORIES = ("SERVER", "SYSTEM", "CONFIG", "JOB", "ENGINE", "CACHE",
                  "STORAGE", "NET")
LOG_DETAIL_SEP = " \u2016 "  # " ‖ " — separates the one-line summary from its detail


def log(message, level="INFO", category="SERVER", detail=None):
    level = str(level).upper()
    category = str(category).upper()
    if level not in LOG_LEVELS:
        level = "INFO"
    if category not in LOG_CATEGORIES:
        category = "SERVER"
    line = str(message)
    if detail:
        line = "%s%s%s" % (line, LOG_DETAIL_SEP, detail)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    sys.stderr.write("[%s] [%s] [%s] %s\n" % (stamp, level, category, line))
    sys.stderr.flush()


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
def load_config(path, cli_args):
    global _config_path
    config = dict(DEFAULT_CONFIG)

    config_path = path or os.path.join(HERE, "config.json")
    _config_path = config_path
    if os.path.isfile(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as handle:
                user_config = json.load(handle)
            if isinstance(user_config, dict):
                config.update({k: v for k, v in user_config.items() if v is not None})
            log("loaded config from %s" % config_path, "INFO", "CONFIG")
        except (OSError, ValueError) as err:
            log("could not read %s: %s" % (config_path, err), "ERROR", "CONFIG")

    for env_key, config_key in ENV_OVERRIDES.items():
        value = os.environ.get(env_key)
        if value not in (None, ""):
            config[config_key] = value

    if cli_args.host:
        config["host"] = cli_args.host
    if cli_args.port:
        config["port"] = cli_args.port
    if cli_args.engine:
        config["engine_path"] = cli_args.engine
    if cli_args.verbose:
        config["verbose"] = True

    try:
        config["port"] = int(config["port"])
    except (TypeError, ValueError):
        config["port"] = 18760
    try:
        config["threads"] = int(config["threads"])
    except (TypeError, ValueError):
        config["threads"] = 4
    try:
        config["timeout"] = int(config["timeout"])
    except (TypeError, ValueError):
        config["timeout"] = 3600
    return config


def bundled_candidates():
    """Locations of the engine executable shipped inside the project.

    All paths are derived from this file's location, so the project keeps
    working no matter where the folder is copied or what the CWD is.
    """
    names = ["ArxivTranslateEngine.exe", "ArxivTranslateEngine"]
    dirs = [
        os.path.join(ROOT, "engine"),
        os.path.join(HERE, "engine"),
        os.path.join(ROOT, "engine", "build"),
        os.path.join(HERE, "engine", "build"),
        os.path.join(ROOT, "bin"),
        os.path.join(HERE, "bin"),
        ROOT,
        HERE,
    ]
    for directory in dirs:
        for name in names:
            yield os.path.join(directory, name)


def is_executable_available(exe):
    return bool(shutil.which(exe)) or os.path.isfile(str(exe))


def resolve_executable(path):
    """Resolve the engine executable.

    Order: explicit value (PATH, then relative to the project, then as-is),
    then a binary bundled under the project.
    """
    candidate = str(path or "").strip()
    if candidate:
        found = shutil.which(candidate)
        if found:
            return found
        for base in (HERE, ROOT, os.getcwd()):
            full = os.path.join(base, candidate)
            if os.path.isfile(full):
                return os.path.abspath(full)
        if os.path.isfile(candidate):
            return os.path.abspath(candidate)
        if os.name == "nt" and not candidate.lower().endswith(".exe"):
            found = shutil.which(candidate + ".exe")
            if found:
                return found
            for base in (HERE, ROOT):
                full = os.path.join(base, candidate + ".exe")
                if os.path.isfile(full):
                    return os.path.abspath(full)
        return candidate

    for bundled in bundled_candidates():
        if os.path.isfile(bundled):
            return os.path.abspath(bundled)

    found = shutil.which("ArxivTranslateEngine")
    return found or "ArxivTranslateEngine"


# --------------------------------------------------------------------------- #
# Config API (edit server/config.json from the browser)
# --------------------------------------------------------------------------- #
def mask_key(value):
    value = str(value or "")
    if not value:
        return ""
    if len(value) <= 12:
        return "*****"
    return value[:8] + "*****" + value[-4:]


def config_path():
    return _config_path or os.path.join(HERE, "config.json")


def config_public():
    return {
        "config_path": config_path(),
        "service": _config.get("service", ""),
        "openai_base_url": _config.get("openai_base_url", ""),
        "openai_model": _config.get("openai_model", ""),
        "openai_api_key_set": bool(_config.get("openai_api_key")),
        "openai_api_key_masked": mask_key(_config.get("openai_api_key")),
        "engine_path": _config.get("engine_path", ""),
        "use_babeldoc": bool(_config.get("use_babeldoc")),
        "extra_args": _config.get("extra_args", ""),
        "update_url": _config.get("update_url", ""),
        "timeout": _config.get("timeout", 3600),
        "port": _config.get("port", 18760),
        "source_lang": _config.get("source_lang", "en"),
        "target_lang": _config.get("target_lang", "zh-CN"),
        "output_variant": _config.get("output_variant", "dual"),
        "threads": _config.get("threads", 4),
    }


def save_config_file():
    try:
        with open(config_path(), "w", encoding="utf-8") as handle:
            json.dump(_config, handle, ensure_ascii=False, indent=2)
        return True
    except OSError as err:
        log("failed to write config %s: %s" % (config_path(), err), "ERROR", "CONFIG")
        return False


def update_config(updates):
    if not isinstance(updates, dict):
        return False
    changed = []
    for field in WRITABLE_CONFIG:
        if field not in updates:
            continue
        value = updates[field]
        if field == "use_babeldoc":
            _config[field] = bool(value)
        elif field in ("timeout", "threads"):
            try:
                _config[field] = int(value)
            except (TypeError, ValueError):
                continue
        elif field == "output_variant":
            variant = str(value or "")
            if variant not in ("dual", "mono"):
                continue
            _config[field] = variant
        else:
            _config[field] = "" if value is None else str(value)
        changed.append(field)
    ok = save_config_file()
    if changed:
        log("config updated: %s (saved=%s)" % (", ".join(changed), ok),
            "INFO" if ok else "ERROR", "CONFIG")
    return ok


# --------------------------------------------------------------------------- #
# System integration (autostart / shortcut / logs) — used by the web console
# --------------------------------------------------------------------------- #
def find_launcher_exe():
    for base in (os.path.join(ROOT, "launcher"), HERE, ROOT):
        for name in LAUNCHER_NAMES:
            path = os.path.join(base, name)
            if os.path.isfile(path):
                return os.path.abspath(path)
    return ""


def get_autostart():
    if os.name != "nt":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _ = winreg.QueryValueEx(key, RUN_NAME)
            return bool(value)
    except OSError:
        return False


def set_autostart(enabled):
    if os.name != "nt":
        return False
    import winreg
    launcher = find_launcher_exe()
    if not launcher:
        log("autostart: launcher executable not found", "WARN", "SYSTEM")
        return False
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, '"%s" --tray' % launcher)
            else:
                try:
                    winreg.DeleteValue(key, RUN_NAME)
                except FileNotFoundError:
                    pass
        log("autostart %s -> %s" % ("enabled" if enabled else "disabled", launcher),
            "INFO", "SYSTEM")
        return True
    except OSError as err:
        log("autostart failed: %s" % err, "ERROR", "SYSTEM")
        return False


def desktop_dir():
    """Resolve the current user's Desktop folder (honors relocation to D: etc.)."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class _GUID(ctypes.Structure):
                _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                            ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

            uid = uuid.UUID("B4BFCC3A-DB2C-424C-B029-7FE99A87C641")  # FOLDERID_Desktop
            guid = _GUID(uid.time_low, uid.time_mid, uid.time_hi_version,
                         (ctypes.c_ubyte * 8)(*uid.bytes[8:]))
            ptr = ctypes.c_wchar_p()
            get_path = ctypes.windll.shell32.SHGetKnownFolderPath
            get_path.argtypes = [ctypes.POINTER(_GUID), wintypes.DWORD,
                                 wintypes.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
            get_path.restype = ctypes.c_long
            if get_path(ctypes.byref(guid), 0, None, ctypes.byref(ptr)) == 0 and ptr.value:
                path = ptr.value
                ctypes.windll.ole32.CoTaskMemFree(ctypes.cast(ptr, ctypes.c_void_p))
                return path
        except Exception:
            pass
        try:
            import winreg
            with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
                value, _ = winreg.QueryValueEx(key, "Desktop")
                value = os.path.expandvars(str(value))
                if value:
                    return value
        except OSError:
            pass
    return os.path.join(os.path.expanduser("~"), "Desktop")


def create_shortcut():
    if os.name != "nt":
        return ""
    launcher = find_launcher_exe()
    if not launcher:
        return ""
    desktop = desktop_dir()
    target = os.path.join(desktop, SHORTCUT_NAME)
    icon = os.path.join(ICONS_DIR, "icon.ico")

    def q(value):
        return str(value).replace("'", "''")

    script = (
        "$ws = New-Object -ComObject WScript.Shell; "
        "$s = $ws.CreateShortcut('%s'); "
        "$s.TargetPath = '%s'; "
        "$s.WorkingDirectory = '%s'; "
        "$s.Description = 'Arxiv PDF Translate'; "
        "$s.IconLocation = '%s'; "
        "$s.Save()"
    ) % (q(target), q(launcher), q(ROOT), q(icon))
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as err:
        log("shortcut failed: %s" % err, "ERROR", "SYSTEM")
        return ""
    created = target if os.path.isfile(target) else ""
    log("shortcut %s: %s" % ("created" if created else "failed", target),
        "INFO" if created else "ERROR", "SYSTEM")
    return created


LOG_LINE_RE = re.compile(
    r"^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] \[([A-Z]+)\] \[([A-Z]+)\] (.*)$")
LOG_JOB_RE = re.compile(r"\bjob ([0-9a-fA-F]{8,})")


def parse_log_line(raw):
    """Parse one line of the current log format:
    [YYYY-MM-DD HH:MM:SS] [LEVEL] [CATEGORY] message [ ‖ detail]"""
    text = raw.rstrip("\r\n")
    match = LOG_LINE_RE.match(text)
    if not match:
        return None
    time_s, level, category, rest = match.groups()
    detail = ""
    if LOG_DETAIL_SEP in rest:
        rest, detail = rest.split(LOG_DETAIL_SEP, 1)
        detail = detail.strip()
    entry = {"time": time_s, "level": level, "category": category,
             "message": rest.rstrip(), "detail": detail, "job": "", "raw": text}
    found = LOG_JOB_RE.search(rest)
    if found:
        entry["job"] = found.group(1)
    return entry


def read_log_entries(max_lines=1500):
    try:
        max_lines = max(1, min(int(max_lines), 5000))
    except (TypeError, ValueError):
        max_lines = 1500
    try:
        size = os.path.getsize(LOG_FILE_PATH)
    except OSError:
        return []
    chunk = 512 * 1024
    try:
        with open(LOG_FILE_PATH, "rb") as handle:
            if size > chunk:
                handle.seek(size - chunk)
                data = handle.read()
                newline = data.find(b"\n")
                if newline >= 0:
                    data = data[newline + 1:]
            else:
                data = handle.read()
    except OSError:
        return []
    text = data.decode("utf-8", "replace")
    lines = text.splitlines()
    entries = []
    for line in lines[-max_lines:]:
        if not line.strip():
            continue
        entry = parse_log_line(line)
        if entry is not None:
            entries.append(entry)
    return entries


def clear_log():
    try:
        with open(LOG_FILE_PATH, "w", encoding="utf-8"):
            pass
    except OSError as err:
        log("failed to clear log: %s" % err, "ERROR", "SYSTEM")
        return False
    log("log cleared", "INFO", "SYSTEM")
    return True


# --------------------------------------------------------------------------- #
# Software update (下载补丁 → 校验 → 解压 → 写重启脚本 → 退出 → 重启)
# --------------------------------------------------------------------------- #
UPDATE_DIR = os.path.join(tempfile.gettempdir(), "at-update")

_update_lock = threading.Lock()
_update_state = {
    "state": "idle", "percent": 0, "message": "", "error": "",
    "current": APP_VERSION, "latest": "", "channel": "", "notes": "",
    "extension": False,
}
_server_ref = None


def version_tuple(value):
    parts = re.findall(r"\d+", str(value or ""))
    return tuple(int(p) for p in parts[:4]) or (0,)


def engine_version():
    path = os.path.join(ROOT, "engine", "VERSION")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def _set_update(**fields):
    with _update_lock:
        _update_state.update(fields)


def get_update_state():
    with _update_lock:
        return dict(_update_state)


def fetch_json_url(url, timeout=8):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def update_check():
    url = str(_config.get("update_url") or "").strip()
    if not url:
        return {"ok": False, "error": "未配置更新源（update_url）"}
    try:
        data = fetch_json_url(url)
    except Exception as err:  # noqa: BLE001 - surfaced to the UI
        return {"ok": False, "error": "无法获取更新信息：%s" % err}

    latest = str(data.get("version") or "")
    current = APP_VERSION
    required_engine = str(data.get("engine_version") or "")
    local_engine = engine_version()
    has_update = version_tuple(latest) > version_tuple(current)

    patch = data.get("patch") or {}
    installer = data.get("installer") or {}
    engine_match = (not required_engine) or (required_engine == local_engine)
    use_patch = bool(has_update and engine_match and patch.get("url")
                     and str(patch.get("from") or "") == current)
    installer_url = str(installer.get("url") or "")
    requires_installer = bool(has_update and not use_patch and installer_url)

    return {
        "ok": True,
        "current": current,
        "latest": latest or current,
        "has_update": has_update,
        "engine_version": local_engine,
        "required_engine": required_engine,
        "channel": "patch" if use_patch else ("installer" if requires_installer else "none"),
        "url": str(patch.get("url") or "") if use_patch else "",
        "sha256": str(patch.get("sha256") or "") if use_patch else "",
        "installer_url": installer_url,
        "requires_installer": requires_installer,
        "notes": str(data.get("notes") or ""),
    }


def update_apply():
    with _update_lock:
        if _update_state["state"] in ("downloading", "staging", "ready", "applying"):
            return {"ok": False, "error": "更新已在进行中"}
    info = update_check()
    if not info.get("ok"):
        return info
    if not info.get("has_update"):
        return {"ok": True, "has_update": False}
    if info.get("channel") != "patch":
        return {"ok": False, "error": "此更新需要重新安装，请下载最新安装包"}
    if not info.get("url"):
        return {"ok": False, "error": "更新信息缺少下载地址"}
    _set_update(state="downloading", percent=0, error="", message="下载中…",
                current=info["current"], latest=info["latest"],
                channel=info["channel"], notes=info["notes"], extension=False)
    threading.Thread(target=_run_update, args=(info,), daemon=True).start()
    return {"ok": True, "has_update": True, "channel": info["channel"]}


def _download(url, dest, expected_sha=None):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=30) as response, open(dest, "wb") as handle:
        total = int(response.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            handle.write(chunk)
            digest.update(chunk)
            got += len(chunk)
            _set_update(percent=(int(got * 100 / total) if total else 0))
    actual = digest.hexdigest()
    if expected_sha and actual.lower() != expected_sha.lower():
        raise ValueError("sha256 校验失败（期望 %s… 实际 %s…）"
                         % (expected_sha[:12], actual[:12]))
    return actual


def _stage_update(source):
    url = source.get("url")
    expected_sha = source.get("sha256") or None
    os.makedirs(UPDATE_DIR, exist_ok=True)
    pkg = os.path.join(UPDATE_DIR, "pkg.zip")
    staging = os.path.join(UPDATE_DIR, "staging")
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging, exist_ok=True)
    _set_update(state="downloading", percent=0, message="下载中…")
    _download(url, pkg, expected_sha)
    _set_update(state="staging", percent=100, message="校验并解压…")
    extension = False
    base = os.path.realpath(staging)
    with zipfile.ZipFile(pkg) as archive:
        for name in archive.namelist():
            target = os.path.realpath(os.path.join(staging, name))
            if target != base and not target.startswith(base + os.sep):
                raise ValueError("压缩包包含非法路径：%s" % name)
            if name.replace("\\", "/").startswith("src/"):
                extension = True
        archive.extractall(staging)
    deletes = []
    meta = os.path.join(staging, "patch.json")
    if os.path.isfile(meta):
        try:
            with open(meta, "r", encoding="utf-8-sig") as handle:
                deletes = json.load(handle).get("delete") or []
        except (OSError, ValueError):
            deletes = []
    return staging, deletes, extension


def _write_updater(project_dir, staging_dir, deletes, port):
    launcher = find_launcher_exe()
    bat = os.path.join(UPDATE_DIR, "apply.bat")
    probe = (
        "powershell -NoProfile -Command "
        "\"try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',%d)"
        "|Out-Null;exit 0}catch{exit 1}\" >nul 2>&1" % port
    )
    lines = [
        "@echo off",
        "setlocal",
        'set "PROJ=%s"' % project_dir,
        'set "STAGE=%s"' % staging_dir,
        "rem 等待旧服务释放端口",
        "for /l %%i in (1,1,30) do (",
        "  " + probe,
        "  if errorlevel 1 goto copy",
        "  timeout /t 1 /nobreak >nul",
        ")",
        ":copy",
        "timeout /t 1 /nobreak >nul",
        'robocopy "%STAGE%" "%PROJ%" /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP /XF _update_* patch.json >nul',
    ]
    for rel in deletes:
        lines.append('del /f /q "%PROJ%\\' + str(rel).replace("/", "\\") + '" 2>nul')
    if launcher:
        lines.append('start "" "%s" --server' % launcher)
    lines.append('(goto) 2>nul & del "%~f0"')
    with open(bat, "w", encoding="ascii", errors="ignore", newline="") as handle:
        handle.write("\r\n".join(lines) + "\r\n")
    return bat


def _run_update(source):
    try:
        staging, deletes, extension = _stage_update(source)
        _set_update(extension=extension, message="准备重启…")
        bat = _write_updater(ROOT, staging, deletes, int(_config.get("port")))
        _set_update(state="ready")
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | \
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(["cmd", "/c", bat], cwd=UPDATE_DIR,
                         creationflags=flags, close_fds=True)
        _set_update(state="applying", message="正在重启服务…")
        time.sleep(1.0)
        log("update staged, restarting to apply", "WARN", "SYSTEM")
        if _server_ref is not None:
            threading.Thread(target=_server_ref.shutdown, daemon=True).start()
    except Exception as err:  # noqa: BLE001 - surfaced to the UI
        log("update failed: %s" % err, "ERROR", "SYSTEM")
        _set_update(state="error", error=str(err), message="更新失败")


# --------------------------------------------------------------------------- #
# Storage / cache
# --------------------------------------------------------------------------- #
STORAGE_DIR = os.path.join(ROOT, "storage")
_storage_lock = threading.Lock()

CACHE_KEY_FIELDS = (
    "service", "source_lang", "target_lang", "output_variant", "pages",
    "use_babeldoc", "skip_subset_fonts", "formula_font_regex", "prompt",
    "extra_args",
)


def ensure_storage():
    os.makedirs(STORAGE_DIR, exist_ok=True)


def index_path():
    return os.path.join(STORAGE_DIR, "index.json")


def load_index():
    ensure_storage()
    try:
        with open(index_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            return [entry for entry in data if isinstance(entry, dict)]
    except (OSError, ValueError):
        pass
    return []


def save_index(entries):
    ensure_storage()
    tmp = index_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(entries, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, index_path())


def cache_key(source_bytes, params):
    digest = hashlib.sha256()
    digest.update(source_bytes or b"")
    digest.update(b"\x00")
    for field in CACHE_KEY_FIELDS:
        digest.update(("%s=%s\x1f" % (field, params.get(field, ""))).encode("utf-8"))
    return digest.hexdigest()[:32]


def cached_path(key):
    return os.path.join(STORAGE_DIR, key + ".pdf")


def content_disposition(filename, disposition="attachment"):
    name = str(filename or "file.pdf")
    ascii_name = name.encode("ascii", "ignore").decode("ascii").replace('"', "") or "file.pdf"
    return "%s; filename=\"%s\"; filename*=UTF-8''%s" % (
        disposition, ascii_name, quote(name))


def lookup_cache(key):
    if not key:
        return None
    path = cached_path(key)
    return path if os.path.isfile(path) else None


def store_result(key, result_path, job, params):
    ensure_storage()
    dest = cached_path(key)
    shutil.copyfile(result_path, dest)
    try:
        size = os.path.getsize(dest)
    except OSError:
        size = 0
    entry = {
        "id": key,
        "name": job.result_name,
        "source_name": params.get("filename") or "source.pdf",
        "source_url": params.get("source_url") or "",
        "service": params.get("service", ""),
        "source_lang": params.get("source_lang", ""),
        "target_lang": params.get("target_lang", ""),
        "output_variant": params.get("output_variant", "dual"),
        "pages": params.get("pages", ""),
        "title": "",
        "group": "",
        "size": size,
        "created_at": time.time(),
    }
    with _storage_lock:
        entries = [e for e in load_index() if e.get("id") != key]
        entries.insert(0, entry)
        save_index(entries)
    if entry["source_url"]:
        threading.Thread(
            target=enrich_entry, args=(key, entry["source_url"]), daemon=True
        ).start()
    log("cache saved: %s (%s, %d bytes)" % (
        key, entry["name"], size), "SUCCESS", "STORAGE")
    return dest


def storage_list():
    with _storage_lock:
        entries = load_index()
    result = []
    total = 0
    for entry in entries:
        path = cached_path(entry.get("id", ""))
        if not os.path.isfile(path):
            continue
        try:
            size = os.path.getsize(path)
        except OSError:
            size = entry.get("size", 0)
        entry = dict(entry)
        entry["size"] = size
        entry["exists"] = True
        total += size
        result.append(entry)
    result.sort(key=lambda item: item.get("created_at", 0), reverse=True)
    return result, total


def storage_delete(key):
    path = cached_path(key)
    removed = False
    if os.path.isfile(path):
        try:
            os.remove(path)
            removed = True
        except OSError:
            pass
    thumb = thumb_path(key)
    if os.path.isfile(thumb):
        try:
            os.remove(thumb)
        except OSError:
            pass
    with _storage_lock:
        entries = load_index()
        remaining = [e for e in entries if e.get("id") != key]
        if len(remaining) != len(entries):
            save_index(remaining)
            removed = True
    if removed:
        log("cache record deleted: %s" % key, "INFO", "STORAGE")
    return removed


def groups_path():
    return os.path.join(STORAGE_DIR, "groups.json")


def load_groups():
    ensure_storage()
    try:
        with open(groups_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, list):
            return [str(g).strip() for g in data if str(g).strip()]
    except (OSError, ValueError):
        pass
    return []


def save_groups(groups):
    ensure_storage()
    tmp = groups_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(groups, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, groups_path())


def create_group(name):
    name = str(name or "").strip()
    if not name:
        return None
    with _storage_lock:
        groups = load_groups()
        if name not in groups:
            groups.append(name)
            save_groups(groups)
            log("group created: %s" % name, "INFO", "STORAGE")
    return name


def delete_group(name):
    name = str(name or "").strip()
    if not name:
        return False
    with _storage_lock:
        groups = load_groups()
        if name not in groups:
            return False
        save_groups([g for g in groups if g != name])
        entries = load_index()
        changed = False
        for entry in entries:
            if entry.get("group") == name:
                entry["group"] = ""
                changed = True
        if changed:
            save_index(entries)
    log("group deleted: %s" % name, "INFO", "STORAGE")
    return True


def set_entry_group(key, group):
    group = str(group or "").strip()
    if group:
        create_group(group)
    return update_entry(key, {"group": group})


def update_entry(key, updates):
    with _storage_lock:
        entries = load_index()
        changed = False
        for entry in entries:
            if entry.get("id") == key:
                entry.update(updates)
                changed = True
                break
        if changed:
            save_index(entries)
    return changed


# --------------------------------------------------------------------------- #
# Title lookup
# --------------------------------------------------------------------------- #
ARXIV_ID_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf)/([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?", re.I)
USER_AGENT = "AT-Bridge/" + BRIDGE_VERSION + " (+local)"


def fetch_url(url, timeout=6):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def arxiv_id(source_url):
    match = ARXIV_ID_RE.search(source_url or "")
    return match.group(1) if match else ""


def fetch_arxiv_title(identifier, timeout=6):
    url = "https://export.arxiv.org/api/query?id_list=" + identifier
    data = fetch_url(url, timeout)
    root = ET.fromstring(data)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    node = root.find(".//atom:entry/atom:title", ns)
    if node is not None and node.text:
        return " ".join(node.text.split())
    return ""


def fetch_html_title(source_url, timeout=6):
    data = fetch_url(source_url, timeout)
    text = data.decode("utf-8", "replace")
    match = re.search(r'<meta[^>]+name=["\']citation_title["\'][^>]+content=["\']([^"\']+)',
                      text, re.I)
    if match:
        return " ".join(match.group(1).split())
    match = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    if match:
        return " ".join(match.group(1).split())[:300]
    return ""


def fetch_title(source_url):
    if not source_url:
        return ""
    try:
        identifier = arxiv_id(source_url)
        if identifier:
            return fetch_arxiv_title(identifier)
        return fetch_html_title(source_url)
    except Exception as err:  # noqa: BLE001 - best effort
        log("title lookup failed for %s: %s" % (source_url, err), "WARN", "NET")
        return ""


def enrich_entry(key, source_url):
    if not source_url:
        return
    title = fetch_title(source_url)
    if title:
        update_entry(key, {"title": title})
        log("entry %s title: %s" % (key, title[:80]), "INFO", "NET")


def enrich_storage(limit=200):
    entries = storage_list()[0]
    for entry in entries[:limit]:
        if not entry.get("title") and entry.get("source_url"):
            enrich_entry(entry.get("id"), entry.get("source_url"))


# --------------------------------------------------------------------------- #
# Thumbnails
# --------------------------------------------------------------------------- #
def bundled_python():
    runtime = os.path.join(ROOT, "engine", "runtime")
    for name in ("python.exe", "python3", "python"):
        candidate = os.path.join(runtime, name)
        if os.path.isfile(candidate):
            return candidate
    return ""


def bundled_site_packages():
    path = os.path.join(ROOT, "engine", "site-packages")
    return path if os.path.isdir(path) else ""


def thumb_path(key):
    return os.path.join(STORAGE_DIR, key + ".thumb.png")


def render_thumbnail(pdf_path, out_path, width=240):
    """Render the first page to a PNG. Best effort, returns bool."""
    if os.path.isfile(out_path):
        return True
    log("generating thumbnail: %s" % os.path.basename(pdf_path), "DEBUG", "STORAGE")

    # Fast path: render in-process if PyMuPDF is importable.
    try:
        import fitz  # type: ignore
        doc = fitz.open(pdf_path)
        page = doc.load_page(0)
        zoom = max(0.2, float(width) / max(1.0, page.rect.width))
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        pix.save(out_path)
        doc.close()
        return os.path.isfile(out_path)
    except Exception:
        pass

    # Fallback: use the bundled runtime + bundled site-packages.
    python = bundled_python()
    site = bundled_site_packages()
    helper = os.path.join(HERE, "make_thumb.py")
    if python and site and os.path.isfile(helper):
        try:
            subprocess.run(
                [python, helper, site, pdf_path, out_path, str(width)],
                timeout=90,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return os.path.isfile(out_path)
    return False


# --------------------------------------------------------------------------- #
# Jobs
# --------------------------------------------------------------------------- #
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
PROGRESS_RE = re.compile(r"(\d{1,3})%\|")
PARTIAL_RE = re.compile(r"ENGINE_PARTIAL\s+(\d+)\s+(\d+)")
BLOCK_RE = re.compile(r"ENGINE_BLOCK\s+(\d+)\s+(\d+)\s+(\d+)")
PAGE_EVENT_RE = re.compile(
    r"ENGINE_PAGE_START\s+(\d+)"
    r"|ENGINE_PAGE_PROGRESS\s+(\d+)\s+(\d+)\s+(\d+)"
)


def read_tail(path, limit=16000):
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - limit))
            return handle.read().decode("utf-8", "replace")
    except OSError:
        return ""


def parse_progress(text):
    if not text:
        return None
    matches = PROGRESS_RE.findall(text)
    if not matches:
        return None
    try:
        return max(0, min(100, int(matches[-1])))
    except ValueError:
        return None


NOISE_PREFIXES = (
    "not in git repo",
    "find offline_assets_zip file:",
    "Namespace(",
    "Press Enter to continue",
)


def clean_log(text, limit=14):
    text = ANSI_RE.sub("", text or "")
    lines = [line.rstrip() for line in text.replace("\r", "\n").split("\n")]
    kept = []
    for line in lines:
        stripped = line.strip()
        if not stripped or "%|" in stripped:
            continue
        if stripped.startswith(NOISE_PREFIXES):
            continue
        kept.append(line)
    return "\n".join(kept[-limit:])


class Job(object):
    def __init__(self, source_bytes, params, filename):
        self.id = uuid.uuid4().hex
        self.source_bytes = source_bytes
        self.params = params
        self.filename = filename or "source.pdf"
        self.status = "queued"
        self.message = "queued"
        self.log_tail = ""
        self.error = None
        self.result_path = None
        self.result_variant = None
        self.variant_files = {}
        self.result_name = self.build_result_name()
        self.workdir = tempfile.mkdtemp(prefix="engine-job-")
        self.proc = None
        self.cancelled = False
        self.created_at = time.time()
        self.finished_at = None
        self.cache_key = None
        self.cached = False
        self.progress = None
        self.done_pages = 0
        self.total_pages = 0
        self.current_page = 0
        self.page_done = 0
        self.page_total = 0
        self.block_page = 0
        self.block_index = 0
        self.block_total = 0

    def build_result_name(self):
        base = os.path.basename(self.filename or "source.pdf")
        if base.lower().endswith(".pdf"):
            base = base[:-4]
        base = base or "translated"
        variant = VARIANT_SUFFIX.get(self.params.get("output_variant", "dual"), "dual")
        lang = self.params.get("target_lang", "zh")
        safe = "".join(ch for ch in base if ch not in '\\/:*?"<>|').strip() or "translated"
        return "%s.%s.%s.pdf" % (safe, variant, lang)

    def public(self):
        return {
            "id": self.id,
            "status": self.status,
            "message": self.message,
            "error": self.error,
            "result_name": self.result_name,
            "log_tail": self.log_tail[-2000:],
            "progress": self.progress,
            "done_pages": self.done_pages,
            "total_pages": self.total_pages,
            "current_page": self.current_page,
            "page_done": self.page_done,
            "page_total": self.page_total,
            "block_page": self.block_page,
            "block_index": self.block_index,
            "block_total": self.block_total,
            "cached": self.cached,
            "elapsed": round((self.finished_at or time.time()) - self.created_at, 1),
        }

    def fail(self, message, detail=None):
        self.status = "error"
        self.error = message
        self.message = "failed"
        self.finished_at = time.time()
        log("job %s failed: %s" % (self.id, message), "ERROR", "JOB", detail=detail)


def parse_params(query):
    get = lambda key, default=None: (query.get(key) or [default])[0]

    def as_bool(key, default=False):
        value = get(key)
        if value is None:
            return default
        return str(value).strip().lower() in ("1", "true", "yes", "on")

    try:
        threads = int(get("threads", _config["threads"]))
    except (TypeError, ValueError):
        threads = _config["threads"]

    return {
        "source_lang": get("source_lang", _config["source_lang"]),
        "target_lang": get("target_lang", _config["target_lang"]),
        "service": get("service", _config["service"]),
        "output_variant": get("output_variant", _config["output_variant"]),
        "pages": get("pages", "") or "",
        "threads": threads,
        "use_babeldoc": as_bool("use_babeldoc", _config["use_babeldoc"]),
        "skip_subset_fonts": as_bool("skip_subset_fonts", False),
        "ignore_cache": as_bool("ignore_cache", False),
        "formula_font_regex": get("formula_font_regex", "") or "",
        "prompt": get("prompt", "") or "",
        "extra_args": get("extra_args", _config["extra_args"]) or "",
        "filename": get("filename", "source.pdf"),
        "source_url": get("source_url", "") or "",
    }


def build_args(params, workdir):
    source = os.path.join(workdir, "source.pdf")
    args = [
        source,
        "-li", str(params["source_lang"]),
        "-lo", str(params["target_lang"]),
        "-s", str(params["service"]),
        "-o", workdir,
    ]
    if params.get("pages"):
        args += ["-p", str(params["pages"])]
    if params.get("threads"):
        args += ["-t", str(params["threads"])]
    if params.get("formula_font_regex"):
        args += ["-f", str(params["formula_font_regex"])]
    if params.get("use_babeldoc"):
        args += ["--babeldoc"]
    if params.get("skip_subset_fonts"):
        args += ["--skip-subset-fonts"]
    if params.get("ignore_cache"):
        args += ["--ignore-cache"]
    if params.get("prompt"):
        args += ["--prompt", str(params["prompt"])]
    if params.get("extra_args"):
        args += shlex.split(str(params["extra_args"]))
    return args


def resolve_result(workdir, variant):
    candidate = os.path.join(workdir, "source-%s.pdf" % VARIANT_SUFFIX.get(variant, "dual"))
    if os.path.isfile(candidate):
        return candidate
    newest = None
    for name in os.listdir(workdir):
        if not name.lower().endswith(".pdf") or name.lower() == "source.pdf":
            continue
        full = os.path.join(workdir, name)
        if newest is None or os.path.getmtime(full) > os.path.getmtime(newest):
            newest = full
    return newest


def log_block_page(job, page):
    """Emit one expandable trace entry summarizing a completed page's blocks."""
    path = os.path.join(job.workdir, "events", "engine-events.jsonl")
    blocks = []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if event.get("page") == page:
                    blocks.append(event)
    except OSError:
        return
    if not blocks:
        return
    detail = json.dumps([
        {
            "index": block.get("index"),
            "total": block.get("total"),
            "bbox": block.get("bbox"),
            "src": (block.get("src") or "")[:400],
            "dst": (block.get("dst") or "")[:400],
        }
        for block in blocks
    ], ensure_ascii=False)
    log("job %s page %d: %d blocks recognized" % (job.id, page, len(blocks)),
        "INFO", "JOB", detail=detail)


def run_job(job):
    params = job.params
    workdir = job.workdir
    log_path = os.path.join(workdir, "engine.log")

    job.cache_key = cache_key(job.source_bytes, params)
    log("job %s cache key %s" % (job.id, job.cache_key), "DEBUG", "CACHE")
    if not params.get("ignore_cache"):
        hit = lookup_cache(job.cache_key)
        if hit:
            job.result_path = hit
            job.status = "done"
            job.message = "已命中本地缓存"
            job.cached = True
            job.finished_at = time.time()
            log("job %s cache hit -> %s" % (job.id, hit), "SUCCESS", "CACHE")
            return
        log("job %s cache miss" % job.id, "INFO", "CACHE")
    else:
        log("job %s cache ignored by request" % job.id, "INFO", "CACHE")

    try:
        with open(os.path.join(workdir, "source.pdf"), "wb") as handle:
            handle.write(job.source_bytes)
        log("job %s staged source.pdf (%d bytes)" % (job.id, len(job.source_bytes or b"")),
            "DEBUG", "JOB")
        job.source_bytes = None
    except OSError as err:
        job.fail("failed to stage uploaded PDF: %s" % err)
        return

    exe = resolve_executable(_config["engine_path"])
    exe_dir = os.path.dirname(exe) if os.path.isfile(exe) else ""
    args = build_args(params, workdir)
    # The bundled engine understands --partial-dir (page-level live preview).
    if os.path.basename(exe).lower() == "arxivtranslateengine.exe":
        partial_dir = os.path.join(workdir, "partials")
        os.makedirs(partial_dir, exist_ok=True)
        args += ["--partial-dir", partial_dir]
        events_dir = os.path.join(workdir, "events")
        os.makedirs(events_dir, exist_ok=True)
        args += ["--events-dir", events_dir]
    env = os.environ.copy()
    if _config.get("openai_base_url"):
        env["OPENAI_BASE_URL"] = str(_config["openai_base_url"])
    if _config.get("openai_api_key"):
        env["OPENAI_API_KEY"] = str(_config["openai_api_key"])
    if _config.get("openai_model"):
        env["OPENAI_MODEL"] = str(_config["openai_model"])
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["PYTHONUNBUFFERED"] = "1"

    job.status = "running"
    job.message = "engine started"
    log("job %s starting engine (service=%s, model=%s)" % (
        job.id, params.get("service"), env.get("OPENAI_MODEL", "")), "INFO", "ENGINE")
    log("job %s command: %s %s" % (job.id, exe, " ".join(args)), "DEBUG", "ENGINE")
    if _verbose:
        log("job %s env: OPENAI_MODEL=%s OPENAI_BASE_URL=%s" % (
            job.id, env.get("OPENAI_MODEL"), env.get("OPENAI_BASE_URL")), "DEBUG", "ENGINE")

    try:
        with open(log_path, "wb") as log_handle:
            job.proc = subprocess.Popen(
                [exe] + args,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                env=env,
                cwd=exe_dir or workdir,
            )
            started = time.time()
            log("job %s engine pid=%s" % (job.id, job.proc.pid), "INFO", "ENGINE")
            last_page = -1
            last_done = -1
            logged_block_pages = set()
            while job.proc.poll() is None:
                if job.cancelled:
                    job.proc.terminate()
                    try:
                        job.proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        job.proc.kill()
                    job.status = "cancelled"
                    job.message = "cancelled by client"
                    job.finished_at = time.time()
                    log("job %s cancelled by client" % job.id, "WARN", "JOB")
                    return
                if time.time() - started > _config["timeout"]:
                    job.proc.kill()
                    job.fail("engine timed out after %ss" % _config["timeout"])
                    return
                raw = read_tail(log_path)
                job.progress = parse_progress(raw)
                matches = PARTIAL_RE.findall(raw)
                if matches:
                    job.done_pages = int(matches[-1][0])
                    job.total_pages = int(matches[-1][1])
                current_page = job.current_page
                page_done = job.page_done
                page_total = job.page_total
                for event in PAGE_EVENT_RE.finditer(raw):
                    if event.group(1) is not None:
                        current_page = int(event.group(1))
                        page_done = 0
                        page_total = 0
                    else:
                        current_page = int(event.group(2))
                        page_done = int(event.group(3))
                        page_total = int(event.group(4))
                job.current_page = current_page
                job.page_done = page_done
                job.page_total = page_total
                block_matches = BLOCK_RE.findall(raw)
                if block_matches:
                    last = block_matches[-1]
                    job.block_page = int(last[0])
                    job.block_index = int(last[1])
                    job.block_total = int(last[2])
                    if (job.block_total and job.block_index == job.block_total
                            and job.block_page not in logged_block_pages):
                        logged_block_pages.add(job.block_page)
                        log_block_page(job, job.block_page)
                job.log_tail = clean_log(raw)
                job.message = last_log_line(raw) or "translating"
                if job.done_pages and job.done_pages != last_done:
                    last_done = job.done_pages
                    log("job %s progress %d/%d pages" % (
                        job.id, job.done_pages, job.total_pages or 0), "INFO", "JOB")
                if current_page and current_page != last_page:
                    last_page = current_page
                    log("job %s page %d/%d" % (
                        job.id, current_page,
                        page_total or job.total_pages or 0), "DEBUG", "JOB")
                time.sleep(0.5)
            exit_code = job.proc.returncode
    except FileNotFoundError:
        job.fail("engine executable not found: %s" % exe)
        return
    except OSError as err:
        job.fail("failed to launch engine: %s" % err)
        return

    job.log_tail = clean_log(read_tail(log_path))
    if exit_code != 0:
        job.fail("engine exited with code %s" % exit_code,
                 detail=json.dumps(job.log_tail[-3000:], ensure_ascii=False))
        return
    log("job %s engine exited 0 in %.1fs" % (job.id, time.time() - started),
        "INFO", "ENGINE")

    job.progress = 100
    if job.total_pages:
        job.done_pages = job.total_pages

    job.result_variant = params.get("output_variant", "dual")
    for variant in ("dual", "mono"):
        variant_path = os.path.join(workdir, "source-%s.pdf" % variant)
        if os.path.isfile(variant_path):
            job.variant_files[variant] = variant_path
            log("job %s variant '%s' ready" % (job.id, variant), "DEBUG", "ENGINE")

    result = resolve_result(workdir, params.get("output_variant", "dual"))
    if not result:
        job.fail("translated PDF was not produced",
                 detail=json.dumps(job.log_tail[-2000:], ensure_ascii=False))
        return

    try:
        job.result_path = store_result(job.cache_key, result, job, params)
    except OSError as err:
        log("job %s: failed to save to storage: %s" % (job.id, err), "ERROR", "STORAGE")
        job.result_path = result
    job.status = "done"
    job.message = "translation finished"
    job.finished_at = time.time()
    try:
        size = os.path.getsize(job.result_path)
    except OSError:
        size = 0
    log("job %s done in %.1fs -> %s (%d bytes)" % (
        job.id, job.finished_at - job.created_at, job.result_path, size),
        "SUCCESS", "JOB")


def last_log_line(text):
    for line in reversed((text or "").replace("\r", "\n").splitlines()):
        line = ANSI_RE.sub("", line).strip()
        if line and "%|" not in line:
            return line[:140]
    return ""


def create_job(source_bytes, params):
    job = Job(source_bytes, params, params.get("filename"))
    with _jobs_lock:
        _jobs[job.id] = job
    log("job %s created: %s | %s -> %s | %s | pages=%s | threads=%s | %d bytes" % (
        job.id, job.filename, params.get("source_lang"), params.get("target_lang"),
        params.get("output_variant"), params.get("pages") or "all",
        params.get("threads"), len(source_bytes or b"")), "INFO", "JOB")
    log("job %s params: source_url=%s prompt=%s extra_args=%s"
        % (job.id, params.get("source_url") or "-",
           (params.get("prompt") or "")[:80] or "-", params.get("extra_args") or "-"),
        "DEBUG", "JOB")
    thread = threading.Thread(target=run_job, args=(job,), daemon=True)
    thread.start()
    return job


def cleanup_job(job):
    if not _config.get("keep_temp"):
        shutil.rmtree(job.workdir, ignore_errors=True)
    with _jobs_lock:
        _jobs.pop(job.id, None)


def cleanup_stale_jobs(max_age=6 * 3600):
    now = time.time()
    with _jobs_lock:
        stale = [j for j in _jobs.values()
                 if j.finished_at and now - j.finished_at > max_age]
    for job in stale:
        cleanup_job(job)


# --------------------------------------------------------------------------- #
# HTTP server / handler
# --------------------------------------------------------------------------- #
class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # Browsers routinely close keep-alive connections early (popup closed,
        # poll aborted, tab navigated). Those are not real errors.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        log("request error from %s: %r" % (client_address, exc))


class Handler(BaseHTTPRequestHandler):
    server_version = "ATBridge/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if _verbose:
            log("HTTP %s - %s" % (self.address_string(), fmt % args), "DEBUG", "SERVER")

    # -- helpers ----------------------------------------------------------- #
    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, status, content_type, data, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def serve_static(self, base_dir, name):
        if not name or name in (".", "..") or name != os.path.basename(name):
            self.send_json(404, {"error": "not found"})
            return
        path = os.path.join(base_dir, name)
        if not os.path.isfile(path):
            self.send_json(404, {"error": "not found"})
            return
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self.send_json(500, {"error": "failed to read asset: %s" % err})
            return
        content_type = MIME_TYPES.get(os.path.splitext(name)[1].lower(),
                                      "application/octet-stream")
        self.send_bytes(200, content_type, data, {"Cache-Control": "no-cache"})

    def handle_system(self):
        self.send_json(200, {
            "platform": platform.system().lower(),
            "pid": os.getpid(),
            "version": BRIDGE_VERSION,
            "app_version": APP_VERSION,
            "engine_version": engine_version(),
            "config_path": config_path(),
            "project_root": ROOT,
            "log_file": LOG_FILE_PATH,
            "console_url": "http://%s:%s/" % (_config["host"], _config["port"]),
            "launcher": find_launcher_exe(),
            "autostart_supported": os.name == "nt",
            "autostart": get_autostart(),
            "shortcut_supported": os.name == "nt",
        })

    def handle_shutdown(self):
        log("shutdown requested via API", "WARN", "SYSTEM")
        self.send_json(200, {"ok": True})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    # -- routes ------------------------------------------------------------ #
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        parts = [p for p in parsed.path.split("/") if p]

        if parsed.path in ("/", "/console", "/console/", "/index.html"):
            self.serve_static(WEB_DIR, "console.html")
            return

        if parsed.path == "/favicon.ico":
            self.serve_static(ICONS_DIR, "icon.ico")
            return

        if parsed.path == "/health":
            self.handle_health()
            return

        if parsed.path == "/system":
            self.handle_system()
            return

        if parsed.path == "/logs":
            entries = read_log_entries((query.get("lines") or ["1500"])[0])
            self.send_json(200, {
                "path": LOG_FILE_PATH,
                "count": len(entries),
                "entries": entries,
            })
            return

        if parsed.path == "/update/check":
            self.send_json(200, update_check())
            return

        if parsed.path == "/update/progress":
            self.send_json(200, get_update_state())
            return

        if len(parts) == 2 and parts[0] in ("web", "icons"):
            self.serve_static(WEB_DIR if parts[0] == "web" else ICONS_DIR, parts[1])
            return

        if parsed.path == "/config":
            self.send_json(200, config_public())
            return

        if parsed.path in ("/jobs", "/jobs/"):
            with _jobs_lock:
                items = list(_jobs.values())
            items.sort(key=lambda item: item.created_at, reverse=True)
            payload = []
            for item in items:
                data = item.public()
                data["filename"] = item.filename
                data["created_at"] = item.created_at
                payload.append(data)
            self.send_json(200, {"jobs": payload})
            return

        if len(parts) >= 2 and parts[0] == "jobs":
            job_id = parts[1]
            job = _jobs.get(job_id)
            if not job:
                self.send_json(404, {"error": "job not found"})
                return
            if len(parts) >= 3 and parts[2] == "result":
                self.handle_result(job, query)
                return
            if len(parts) >= 3 and parts[2] == "partial":
                self.handle_partial(job, query)
                return
            if len(parts) >= 3 and parts[2] == "blocks":
                self.handle_blocks(job)
                return
            self.send_json(200, job.public())
            return

        if parts and parts[0] == "storage":
            if len(parts) == 1:
                self.handle_storage_list()
                return
            if len(parts) == 2 and parts[1] == "groups":
                self.send_json(200, {"groups": load_groups()})
                return
            if len(parts) == 2:
                self.handle_storage_file(parts[1])
                return
            if len(parts) == 3 and parts[2] == "thumb.png":
                self.handle_storage_thumb(parts[1])
                return

        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        parts = [p for p in parsed.path.split("/") if p]
        if parsed.path == "/jobs":
            self.handle_create_job(query)
            return
        if parsed.path == "/translate":
            self.handle_sync_translate(query)
            return
        if parsed.path == "/config":
            ok = update_config(self.read_json())
            payload = config_public()
            payload["ok"] = ok
            self.send_json(200 if ok else 500, payload)
            return
        if parsed.path == "/autostart":
            enabled = bool(self.read_json().get("enabled"))
            ok = set_autostart(enabled)
            self.send_json(200 if ok else 500, {"ok": ok, "autostart": get_autostart()})
            return
        if parsed.path == "/shortcut":
            path = create_shortcut()
            self.send_json(200 if path else 500, {"ok": bool(path), "path": path})
            return
        if parsed.path == "/server/shutdown":
            self.handle_shutdown()
            return
        if parsed.path == "/logs/clear":
            self.send_json(200, {"ok": clear_log()})
            return
        if parsed.path == "/update/apply":
            self.send_json(200, update_apply())
            return
        if parsed.path == "/storage/groups":
            self.handle_create_group()
            return
        if len(parts) == 3 and parts[0] == "storage" and parts[2] == "group":
            self.handle_set_group(parts[1])
            return
        self.send_json(404, {"error": "not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] == "jobs":
            job = _jobs.get(parts[1])
            if not job:
                self.send_json(404, {"error": "job not found"})
                return
            job.cancelled = True
            cleanup_job(job)
            self.send_json(200, {"ok": True})
            return
        if len(parts) == 3 and parts[0] == "storage" and parts[1] == "groups":
            removed = delete_group(unquote(parts[2]))
            self.send_json(200 if removed else 404, {"ok": removed})
            return
        if len(parts) == 2 and parts[0] == "storage":
            removed = storage_delete(parts[1])
            self.send_json(200 if removed else 404, {"ok": removed})
            return
        self.send_json(404, {"error": "not found"})

    # -- implementations --------------------------------------------------- #
    def handle_health(self):
        exe = resolve_executable(_config["engine_path"])
        available = is_executable_available(exe)
        self.send_json(200, {
            "ok": True,
            "service": "translate-bridge",
            "version": BRIDGE_VERSION,
            "engine": exe,
            "engine_available": available,
            "defaults": {
                "source_lang": _config["source_lang"],
                "target_lang": _config["target_lang"],
                "output_variant": _config["output_variant"],
                "threads": _config["threads"],
            },
        })

    def handle_create_job(self, query):
        body = self.read_body()
        if not body:
            self.send_json(400, {"error": "empty PDF body"})
            return
        if not body[:5] == b"%PDF-" and b"%PDF-" not in body[:1024]:
            self.send_json(400, {"error": "request body is not a PDF"})
            return
        params = parse_params(query)
        log("POST /jobs upload (%d bytes)" % len(body), "INFO", "SERVER")
        job = create_job(body, params)
        self.send_json(200, {"id": job.id, "status": job.status, "result_name": job.result_name})

    def handle_result(self, job, query=None):
        variant = None
        if query:
            variant = (query.get("variant") or [None])[0]
        if variant not in ("dual", "mono"):
            variant = job.result_variant or _config.get("output_variant", "dual")

        path = job.variant_files.get(variant)
        if not path or not os.path.isfile(path):
            path = job.result_path
        if job.status != "done" or not path or not os.path.isfile(path):
            self.send_json(409, {"error": "result not ready", "status": job.status})
            return
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self.send_json(500, {"error": "failed to read result: %s" % err})
            return
        name = re.sub(r"\.(dual|mono)\.", ".%s." % variant, job.result_name or "result.pdf")
        self.send_bytes(200, "application/pdf", data, {
            "Content-Disposition": content_disposition(name, "attachment"),
        })

    def handle_partial(self, job, query):
        variant = (query.get("variant") or ["dual"])[0]
        if variant not in ("dual", "mono"):
            variant = "dual"
        path = os.path.join(job.workdir, "partials", "partial-%s.pdf" % variant)
        if not os.path.isfile(path):
            self.send_json(404, {"error": "partial not ready"})
            return
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self.send_json(500, {"error": "failed to read partial: %s" % err})
            return
        self.send_bytes(200, "application/pdf", data, {
            "Cache-Control": "no-store",
            "Content-Disposition": content_disposition(
                job.result_name or "partial.pdf", "inline"),
        })

    def handle_blocks(self, job):
        path = os.path.join(job.workdir, "events", "engine-events.jsonl")
        blocks = []
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    for line in handle:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            blocks.append(json.loads(line))
                        except ValueError:
                            pass
            except OSError:
                pass
        self.send_bytes(200, "application/json; charset=utf-8",
                        json.dumps({"blocks": blocks}).encode("utf-8"),
                        {"Cache-Control": "no-store"})

    def handle_storage_list(self):
        entries, total = storage_list()
        self.send_json(200, {
            "dir": STORAGE_DIR,
            "count": len(entries),
            "total_size": total,
            "groups": load_groups(),
            "entries": entries,
        })

    def handle_storage_file(self, key):
        if not key or not all(ch in "0123456789abcdef" for ch in key.lower()):
            self.send_json(400, {"error": "invalid id"})
            return
        path = cached_path(key)
        if not os.path.isfile(path):
            self.send_json(404, {"error": "not found"})
            return
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self.send_json(500, {"error": "failed to read file: %s" % err})
            return
        filename = key + ".pdf"
        with _storage_lock:
            for entry in load_index():
                if entry.get("id") == key:
                    filename = entry.get("name") or filename
                    break
        self.send_bytes(200, "application/pdf", data, {
            "Content-Disposition": content_disposition(filename, "inline"),
        })

    def handle_storage_thumb(self, key):
        if not key or not all(ch in "0123456789abcdef" for ch in key.lower()):
            self.send_json(400, {"error": "invalid id"})
            return
        pdf = cached_path(key)
        if not os.path.isfile(pdf):
            self.send_json(404, {"error": "not found"})
            return
        out = thumb_path(key)
        if not render_thumbnail(pdf, out):
            self.send_json(404, {"error": "thumbnail unavailable"})
            return
        try:
            with open(out, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self.send_json(500, {"error": "failed to read thumbnail: %s" % err})
            return
        self.send_bytes(200, "image/png", data, {"Cache-Control": "max-age=86400"})

    def read_json(self):
        body = self.read_body()
        if not body:
            return {}
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def handle_create_group(self):
        name = create_group(self.read_json().get("name"))
        if not name:
            self.send_json(400, {"error": "name required"})
            return
        self.send_json(200, {"ok": True, "groups": load_groups()})

    def handle_set_group(self, key):
        if not key or not all(ch in "0123456789abcdef" for ch in key.lower()):
            self.send_json(400, {"error": "invalid id"})
            return
        set_entry_group(key, self.read_json().get("group", ""))
        self.send_json(200, {"ok": True, "groups": load_groups()})

    def handle_sync_translate(self, query):
        body = self.read_body()
        if not body:
            self.send_json(400, {"error": "empty PDF body"})
            return
        params = parse_params(query)
        job = create_job(body, params)
        while job.status in ("queued", "running"):
            time.sleep(0.5)
        if job.status == "done":
            self.handle_result(job)
        else:
            self.send_json(500, {"error": job.error or job.status})


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main(argv=None):
    global _config, _verbose, _server_ref

    # The log file is read back as UTF-8; force stdio to UTF-8 so non-ASCII
    # (Chinese src/dst text) is written correctly regardless of the OS locale.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass

    parser = argparse.ArgumentParser(description="Local translation-engine bridge for the browser extension.")
    parser.add_argument("--host", help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, help="bind port (default 18760)")
    parser.add_argument("--engine", help="path to the engine executable")
    parser.add_argument("--config", help="path to a JSON config file")
    parser.add_argument("--verbose", "-v", action="store_true", help="verbose logging")
    args = parser.parse_args(argv)

    _config = load_config(args.config, args)
    _verbose = bool(_config.get("verbose"))

    try:
        server = BridgeServer((_config["host"], _config["port"]), Handler)
    except OSError as err:
        log("cannot bind %s:%s (%s)" % (_config["host"], _config["port"], err),
            "ERROR", "SYSTEM")
        log("the server may already be running; exiting.", "WARN", "SYSTEM")
        return
    _server_ref = server

    exe = resolve_executable(_config["engine_path"])
    available = is_executable_available(exe)
    log("===== Arxiv PDF Translate server start =====", "INFO", "SYSTEM")
    log("bridge version: %s | pid %d" % (BRIDGE_VERSION, os.getpid()), "INFO", "SYSTEM")
    log("project root: %s" % ROOT, "INFO", "SYSTEM")
    log("storage dir: %s" % STORAGE_DIR, "INFO", "SYSTEM")
    log("listening on http://%s:%s" % (_config["host"], _config["port"]), "INFO", "SYSTEM")
    log("engine: %s (%s)" % (exe, "found" if available else "NOT FOUND"),
        "INFO" if available else "WARN", "ENGINE")
    if not available:
        log("engine not found; put it in <project>/engine/ or set 'engine_path' "
            "in config.json / ENGINE_PATH", "WARN", "ENGINE")

    threading.Thread(target=enrich_storage, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("keyboard interrupt", "WARN", "SYSTEM")
    finally:
        log("server shutting down", "INFO", "SYSTEM")
        with _jobs_lock:
            jobs = list(_jobs.values())
        for job in jobs:
            if job.proc and job.proc.poll() is None:
                job.proc.kill()
            cleanup_job(job)
        server.server_close()


if __name__ == "__main__":
    main()
