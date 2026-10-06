#!/usr/bin/env python3
"""Local companion server for the Arxiv PDF Translate extension.

The browser extension cannot execute local programs, so this small HTTP
service runs on 127.0.0.1. It accepts a raw PDF upload, shells out to the
local ``pdf2zh`` (PDFMathTranslate) executable, and serves the generated
bilingual PDF back to the extension.

Endpoints
---------
GET    /health                     service + pdf2zh availability probe
POST   /jobs?<params>              upload a PDF (raw body), start a job
GET    /jobs/<id>                  poll job status / progress / log tail
GET    /jobs/<id>/result           download the translated PDF
DELETE /jobs/<id>                  cancel and clean up a job
POST   /translate?<params>         synchronous one-shot translation

Only the Python standard library is required. ``pdf2zh`` itself must be
installed separately (``pip install pdf2zh`` or the Windows bundle).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote, unquote

BRIDGE_VERSION = "0.2.0"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8760,
    "pdf2zh_path": "",
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
}

ENV_OVERRIDES = {
    "PDF2ZH_PATH": "pdf2zh_path",
    "PDF2ZH_HOST": "host",
    "PDF2ZH_PORT": "port",
    "PDF2ZH_SERVICE": "service",
    "OPENAI_BASE_URL": "openai_base_url",
    "OPENAI_API_KEY": "openai_api_key",
    "OPENAI_MODEL": "openai_model",
    "PDF2ZH_TIMEOUT": "timeout",
}

VARIANT_SUFFIX = {"dual": "dual", "mono": "mono"}

_jobs = {}
_jobs_lock = threading.Lock()
_config = dict(DEFAULT_CONFIG)
_config_path = None
_verbose = False

WRITABLE_CONFIG = (
    "service", "openai_base_url", "openai_api_key", "openai_model",
    "pdf2zh_path", "use_babeldoc", "extra_args", "timeout",
)


def log(message):
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    sys.stderr.write("[%s] [pdf2zh-server] %s\n" % (stamp, message))
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
            log("loaded config from %s" % config_path)
        except (OSError, ValueError) as err:
            log("could not read %s: %s" % (config_path, err))

    for env_key, config_key in ENV_OVERRIDES.items():
        value = os.environ.get(env_key)
        if value not in (None, ""):
            config[config_key] = value

    if cli_args.host:
        config["host"] = cli_args.host
    if cli_args.port:
        config["port"] = cli_args.port
    if cli_args.pdf2zh:
        config["pdf2zh_path"] = cli_args.pdf2zh
    if cli_args.verbose:
        config["verbose"] = True

    try:
        config["port"] = int(config["port"])
    except (TypeError, ValueError):
        config["port"] = 8760
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
    """Locations of a pdf2zh binary shipped inside the project.

    All paths are derived from this file's location, so the project keeps
    working no matter where the folder is copied or what the CWD is.
    """
    names = ["pdf2zh.exe", "pdf2zh"] if os.name == "nt" else ["pdf2zh", "pdf2zh.exe"]
    dirs = [
        os.path.join(ROOT, "pdf2zh", "build"),
        os.path.join(ROOT, "pdf2zh"),
        os.path.join(HERE, "pdf2zh", "build"),
        os.path.join(HERE, "pdf2zh"),
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
    """Resolve the pdf2zh executable.

    Order: explicit value (PATH, then relative to the project, then as-is),
    then a binary bundled under the project, then ``pdf2zh`` on PATH.
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

    found = shutil.which("pdf2zh") or shutil.which("pdf2zh.exe")
    return found or "pdf2zh"


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
        "pdf2zh_path": _config.get("pdf2zh_path", ""),
        "use_babeldoc": bool(_config.get("use_babeldoc")),
    }


def save_config_file():
    try:
        with open(config_path(), "w", encoding="utf-8") as handle:
            json.dump(_config, handle, ensure_ascii=False, indent=2)
        return True
    except OSError as err:
        log("failed to write config %s: %s" % (config_path(), err))
        return False


def update_config(updates):
    changed = []
    for field in WRITABLE_CONFIG:
        if field not in updates:
            continue
        value = updates[field]
        if field == "use_babeldoc":
            _config[field] = bool(value)
        elif field == "timeout":
            try:
                _config[field] = int(value)
            except (TypeError, ValueError):
                pass
        else:
            _config[field] = "" if value is None else str(value)
        changed.append(field)
    ok = save_config_file()
    if changed:
        log("config updated: %s (saved=%s)" % (", ".join(changed), ok))
    return ok


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
        log("storage deleted: %s" % key)
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
            log("group created: %s" % name)
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
    log("group deleted: %s" % name)
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
USER_AGENT = "PDF2ZH-Bridge/" + BRIDGE_VERSION + " (+local)"


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
        log("title lookup failed for %s: %s" % (source_url, err))
        return ""


def enrich_entry(key, source_url):
    if not source_url:
        return
    title = fetch_title(source_url)
    if title:
        update_entry(key, {"title": title})
        log("entry %s title: %s" % (key, title[:80]))


def enrich_storage(limit=200):
    entries = storage_list()[0]
    for entry in entries[:limit]:
        if not entry.get("title") and entry.get("source_url"):
            enrich_entry(entry.get("id"), entry.get("source_url"))


# --------------------------------------------------------------------------- #
# Thumbnails
# --------------------------------------------------------------------------- #
def bundled_python():
    candidates = [
        os.path.join(ROOT, "pdf2zh", "runtime", "python.exe"),
        os.path.join(ROOT, "pdf2zh", "runtime", "python3"),
        os.path.join(ROOT, "pdf2zh", "runtime", "python"),
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return ""


def bundled_site_packages():
    path = os.path.join(ROOT, "pdf2zh", "site-packages")
    return path if os.path.isdir(path) else ""


def thumb_path(key):
    return os.path.join(STORAGE_DIR, key + ".thumb.png")


def render_thumbnail(pdf_path, out_path, width=240):
    """Render the first page to a PNG. Best effort, returns bool."""
    if os.path.isfile(out_path):
        return True
    log("generating thumbnail: %s" % os.path.basename(pdf_path))

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
        self.result_name = self.build_result_name()
        self.workdir = tempfile.mkdtemp(prefix="pdf2zh-job-")
        self.proc = None
        self.cancelled = False
        self.created_at = time.time()
        self.finished_at = None
        self.cache_key = None
        self.cached = False
        self.progress = None

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
            "cached": self.cached,
            "elapsed": round((self.finished_at or time.time()) - self.created_at, 1),
        }

    def fail(self, message):
        self.status = "error"
        self.error = message
        self.message = "failed"
        self.finished_at = time.time()
        log("job %s failed: %s" % (self.id, message))


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


def run_job(job):
    params = job.params
    workdir = job.workdir
    log_path = os.path.join(workdir, "pdf2zh.log")

    job.cache_key = cache_key(job.source_bytes, params)
    if not params.get("ignore_cache"):
        hit = lookup_cache(job.cache_key)
        if hit:
            job.result_path = hit
            job.status = "done"
            job.message = "已命中本地缓存"
            job.cached = True
            job.finished_at = time.time()
            log("job %s cache hit -> %s" % (job.id, hit))
            return

    try:
        with open(os.path.join(workdir, "source.pdf"), "wb") as handle:
            handle.write(job.source_bytes)
        job.source_bytes = None
    except OSError as err:
        job.fail("failed to stage uploaded PDF: %s" % err)
        return

    exe = resolve_executable(_config["pdf2zh_path"])
    exe_dir = os.path.dirname(exe) if os.path.isfile(exe) else ""
    args = build_args(params, workdir)
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
    job.message = "pdf2zh started"
    log("job %s starting pdf2zh (service=%s, model=%s)" % (
        job.id, params.get("service"), env.get("OPENAI_MODEL", "")))
    log("job %s command: %s %s" % (job.id, exe, " ".join(args)))
    if _verbose:
        log("job %s env: OPENAI_MODEL=%s OPENAI_BASE_URL=%s" % (
            job.id, env.get("OPENAI_MODEL"), env.get("OPENAI_BASE_URL")))

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
                    return
                if time.time() - started > _config["timeout"]:
                    job.proc.kill()
                    job.fail("pdf2zh timed out after %ss" % _config["timeout"])
                    return
                raw = read_tail(log_path)
                job.progress = parse_progress(raw)
                job.log_tail = clean_log(raw)
                job.message = last_log_line(raw) or "translating"
                time.sleep(0.5)
            exit_code = job.proc.returncode
    except FileNotFoundError:
        job.fail("pdf2zh executable not found: %s" % exe)
        return
    except OSError as err:
        job.fail("failed to launch pdf2zh: %s" % err)
        return

    job.log_tail = clean_log(read_tail(log_path))
    if exit_code != 0:
        job.fail("pdf2zh exited with code %s\n%s" % (exit_code, job.log_tail[-3000:]))
        return

    job.progress = 100

    result = resolve_result(workdir, params.get("output_variant", "dual"))
    if not result:
        job.fail("translated PDF was not produced in %s\n%s" % (workdir, job.log_tail[-2000:]))
        return

    try:
        job.result_path = store_result(job.cache_key, result, job, params)
    except OSError as err:
        log("job %s: failed to save to storage: %s" % (job.id, err))
        job.result_path = result
    job.status = "done"
    job.message = "translation finished"
    job.finished_at = time.time()
    try:
        size = os.path.getsize(job.result_path)
    except OSError:
        size = 0
    log("job %s done in %.1fs -> %s (%d bytes)" % (
        job.id, job.finished_at - job.created_at, job.result_path, size))


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
        params.get("threads"), len(source_bytes or b"")))
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
    server_version = "PDF2ZHBridge/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if _verbose:
            log("%s - %s" % (self.address_string(), fmt % args))

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

    # -- routes ------------------------------------------------------------ #
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]

        if parsed.path in ("/", "/health"):
            self.handle_health()
            return

        if parsed.path == "/config":
            self.send_json(200, config_public())
            return

        if len(parts) >= 2 and parts[0] == "jobs":
            job_id = parts[1]
            job = _jobs.get(job_id)
            if not job:
                self.send_json(404, {"error": "job not found"})
                return
            if len(parts) >= 3 and parts[2] == "result":
                self.handle_result(job)
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
        exe = resolve_executable(_config["pdf2zh_path"])
        available = is_executable_available(exe)
        self.send_json(200, {
            "ok": True,
            "service": "pdf2zh-bridge",
            "version": BRIDGE_VERSION,
            "pdf2zh": exe,
            "pdf2zh_available": available,
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
        job = create_job(body, params)
        self.send_json(200, {"id": job.id, "status": job.status, "result_name": job.result_name})

    def handle_result(self, job):
        if job.status != "done" or not job.result_path or not os.path.isfile(job.result_path):
            self.send_json(409, {"error": "result not ready", "status": job.status})
            return
        try:
            with open(job.result_path, "rb") as handle:
                data = handle.read()
        except OSError as err:
            self.send_json(500, {"error": "failed to read result: %s" % err})
            return
        self.send_bytes(200, "application/pdf", data, {
            "Content-Disposition": content_disposition(job.result_name, "attachment"),
        })

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
    global _config, _verbose

    parser = argparse.ArgumentParser(description="Local pdf2zh bridge for the browser extension.")
    parser.add_argument("--host", help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, help="bind port (default 8760)")
    parser.add_argument("--pdf2zh", help="path to the pdf2zh executable")
    parser.add_argument("--config", help="path to a JSON config file")
    parser.add_argument("--verbose", "-v", action="store_true", help="verbose logging")
    args = parser.parse_args(argv)

    _config = load_config(args.config, args)
    _verbose = bool(_config.get("verbose"))

    try:
        server = BridgeServer((_config["host"], _config["port"]), Handler)
    except OSError as err:
        log("cannot bind %s:%s (%s)" % (_config["host"], _config["port"], err))
        log("the server may already be running; exiting.")
        return

    exe = resolve_executable(_config["pdf2zh_path"])
    available = is_executable_available(exe)
    log("bridge version: %s (storage cache enabled)" % BRIDGE_VERSION)
    log("project root: %s" % ROOT)
    log("storage dir: %s" % STORAGE_DIR)
    log("listening on http://%s:%s" % (_config["host"], _config["port"]))
    log("pdf2zh: %s (%s)" % (exe, "found" if available else "NOT FOUND"))
    if not available:
        log("warning: pdf2zh was not found; put it in <project>/pdf2zh/ or set "
            "'pdf2zh_path' in config.json / PDF2ZH_PATH")

    threading.Thread(target=enrich_storage, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        with _jobs_lock:
            jobs = list(_jobs.values())
        for job in jobs:
            if job.proc and job.proc.poll() is None:
                job.proc.kill()
            cleanup_job(job)
        server.server_close()


if __name__ == "__main__":
    main()
