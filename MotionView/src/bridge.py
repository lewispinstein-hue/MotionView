import argparse
import asyncio
import os
import signal
import sys
import shutil
from pathlib import Path
from typing import Optional, Set, List
import platform
import re
import time
import zipfile
from datetime import datetime

from fastapi import FastAPI, Request
from pydantic import BaseModel
from fastapi.websockets import WebSocket
from starlette.middleware.cors import CORSMiddleware
import uvicorn

# PROS_PROJECT_DIR can be updated via API
PROS_PROJECT_DIR = None
# Lock will be created when needed (can't create Lock outside async context)
PROS_PROJECT_DIR_LOCK = None

def _get_lock():
    """Get or create the lock for PROS_PROJECT_DIR updates."""
    global PROS_PROJECT_DIR_LOCK
    if PROS_PROJECT_DIR_LOCK is None:
        try: 
            PROS_PROJECT_DIR_LOCK = asyncio.Lock()
        except RuntimeError:
            # No event loop running, create new lock
            PROS_PROJECT_DIR_LOCK = asyncio.Lock()
    return PROS_PROJECT_DIR_LOCK

def _candidate_vscode_install_bases() -> List[Path]:
    """
    Returns candidate base directories that should contain:
      .../User/globalStorage/sigbots.pros/install
    across VS Code stable/insiders and VSCodium.
    """
    sys = platform.system()

    if sys == "Darwin":
        app_support = Path.home() / "Library" / "Application Support"
        roots = [
            app_support / "Code",
            app_support / "Code - Insiders",
            app_support / "VSCodium",
        ]
        return [r / "User" / "globalStorage" / "sigbots.pros" / "install" for r in roots]

    if sys == "Windows":
        # APPDATA points at: C:\Users\<you>\AppData\Roaming
        appdata = os.environ.get("APPDATA", "")
        if not appdata:
            return []
        roots = [
            Path(appdata) / "Code",
            Path(appdata) / "Code - Insiders",
            Path(appdata) / "VSCodium",
        ]
        return [r / "User" / "globalStorage" / "sigbots.pros" / "install" for r in roots]

    # Linux
    # Common locations: ~/.config/Code, ~/.config/Code - Insiders, ~/.config/VSCodium
    config = Path.home() / ".config"
    roots = [
        config / "Code",
        config / "Code - Insiders",
        config / "VSCodium",
    ]
    return [r / "User" / "globalStorage" / "sigbots.pros" / "install" for r in roots]

def _prepend_path(p: Path):
    if not p.is_dir():
        return
    cur = os.environ.get("PATH", "")
    sep = ";" if platform.system() == "Windows" else ":"
    parts = cur.split(sep) if cur else []
    s = str(p)
    if s not in parts:
        os.environ["PATH"] = s + (sep + cur if cur else "")

def configure_pros_env_from_vscode() -> Optional[str]:
    """
    If PROS is installed by the sigbots.pros VS Code extension, configure PATH/PROS_TOOLCHAIN
    similarly to "PROS: Integrated Terminal", and return absolute path to pros executable.
    """
    sys = platform.system()

    for base in _candidate_vscode_install_bases():
        if not base.is_dir():
            continue

        if sys == "Darwin":
            pros_dir = base / "pros-cli-macos"
            toolchain_dir = base / "pros-toolchain-macos"
            vexcom_dir = base / "vex-vexcom-macos"
            pros_exe = pros_dir / "pros"
        elif sys == "Windows":
            pros_dir = base / "pros-cli-windows"
            toolchain_dir = base / "pros-toolchain-windows"
            vexcom_dir = base / "vex-vexcom-windows"
            pros_exe = pros_dir / "pros.exe"
        else:
            pros_dir = base / "pros-cli-linux"
            toolchain_dir = base / "pros-toolchain-linux"
            vexcom_dir = base / "vex-vexcom-linux"
            pros_exe = pros_dir / "pros"

        if not pros_exe.exists():
            continue

        # PROS_TOOLCHAIN matches what the extension typically sets
        if toolchain_dir.is_dir():
            os.environ["PROS_TOOLCHAIN"] = str(toolchain_dir)

        # PATH entries (order matters: prepend)
        if sys == "Windows":
            # On Windows the toolchain binaries commonly live under ...\usr\bin
            _prepend_path(vexcom_dir)
            _prepend_path(toolchain_dir / "usr" / "bin")
            _prepend_path(pros_dir)
        else:
            _prepend_path(vexcom_dir)
            _prepend_path(toolchain_dir / "bin")
            _prepend_path(pros_dir)

        return str(pros_exe)

    return None

def _bundle_search_roots_from_env() -> List[Path]:
    raw = os.environ.get("MOTIONVIEW_BUNDLE_ROOTS", "")
    if not raw:
        return []

    roots: List[Path] = []
    for part in raw.split(os.pathsep):
        part = part.strip()
        if not part:
            continue
        try:
            roots.append(Path(part).expanduser().resolve())
        except Exception:
            continue
    return roots

def _expand_bundle_search_roots(base_roots: List[Path]) -> List[Path]:
    expanded: List[Path] = []
    for root in base_roots:
        expanded.extend([
            root,
            root / "bin",
            root / "src-tauri" / "bin",
            root / "_up_",
            root / "_up_" / "bin",
            root / "_up_" / "src-tauri" / "bin",
            root / "__up__",
            root / "__up__" / "bin",
            root / "__up__" / "src-tauri" / "bin",
            root / "Resources",
            root / "Resources" / "bin",
            root / "Resources" / "src-tauri" / "bin",
            root / "Resources" / "_up_",
            root / "Resources" / "_up_" / "src-tauri" / "bin",
        ])
    return expanded

def resolve_bundled_pros_exe() -> Optional[str]:
    exe_ext = ".exe" if platform.system() == "Windows" else ""
    exact_names = [f"motionview-pros{exe_ext}"]
    glob_patterns = [f"motionview-pros-*{exe_ext}"]
    runtime_dirs = ["motionview-pros"]
    archive_names = ["motionview-pros.zip"]

    roots: List[Path] = []
    roots.extend(_expand_bundle_search_roots(_bundle_search_roots_from_env()))
    if getattr(sys, "frozen", False):
        try:
            exe_dir = Path(sys.executable).resolve().parent
            roots.extend([
                exe_dir,
                exe_dir / "bin",
                exe_dir / "_up_",
                exe_dir / "_up_" / "bin",
                exe_dir / "_up_" / "src-tauri" / "bin",
                exe_dir / "_up_" / "src-tauri" / "bin" / "motionview-pros" / "motionview-pros",
                exe_dir / "__up__",
                exe_dir / "__up__" / "bin",
                exe_dir / "__up__" / "src-tauri" / "bin",
                exe_dir.parent,
                exe_dir.parent / "bin",
                exe_dir.parent / "Resources",
                exe_dir.parent / "Resources" / "bin",
                exe_dir.parent / "Resources" / "_up_",
                exe_dir.parent / "Resources" / "_up_" / "src-tauri" / "bin",
                exe_dir.parent / "Resources" / "src-tauri" / "bin",
                exe_dir.parent / "_up_",
                exe_dir.parent / "_up_" / "bin",
                exe_dir.parent / "_up_" / "src-tauri" / "bin",
                exe_dir.parent / "_up_" / "src-tauri" / "bin" / "motionview-pros" / "motionview-pros",
                exe_dir.parent / "__up__",
                exe_dir.parent / "__up__" / "bin",
                exe_dir.parent / "__up__" / "src-tauri" / "bin",
            ])
        except Exception:
            pass
    else:
        repo_root = Path(__file__).resolve().parent.parent
        roots.extend([
            repo_root / "src-tauri" / "bin",
            repo_root / "dist",
        ])

    seen: Set[str] = set()
    for root in roots:
        try:
            resolved_root = root.expanduser().resolve()
        except Exception:
            continue
        if not resolved_root.is_dir():
            continue

        candidates: List[Path] = []
        for name in exact_names:
            candidates.append(resolved_root / name)
        for pattern in glob_patterns:
            candidates.extend(sorted(resolved_root.glob(pattern)))
        for runtime_dir in runtime_dirs:
            candidates.append(resolved_root / runtime_dir / f"{runtime_dir}{exe_ext}")

        for candidate in candidates:
            try:
                resolved_candidate = candidate.expanduser().resolve()
            except Exception:
                continue
            key = str(resolved_candidate)
            if key in seen:
                continue
            seen.add(key)
            if resolved_candidate.exists() and resolved_candidate.is_file():
                return key

        if getattr(sys, "frozen", False):
            for archive_name in archive_names:
                archive_path = resolved_root / archive_name
                try:
                    resolved_archive = archive_path.expanduser().resolve()
                except Exception:
                    continue
                if not resolved_archive.exists() or not resolved_archive.is_file():
                    continue
                extracted = extract_bundled_pros_archive(resolved_archive)
                if extracted:
                    return extracted

    return None

def motionview_support_dir() -> Path:
    sys_name = platform.system()
    if sys_name == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.motionview.motionview"
    if sys_name == "Windows":
        base = os.environ.get("APPDATA")
        if base:
            return Path(base) / "com.motionview.motionview"
        return Path.home() / "AppData" / "Roaming" / "com.motionview.motionview"
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg) / "com.motionview.motionview"
    return Path.home() / ".local" / "share" / "com.motionview.motionview"

def extract_bundled_pros_archive(archive_path: Path) -> Optional[str]:
    exe_ext = ".exe" if platform.system() == "Windows" else ""
    runtime_root = motionview_support_dir() / "Runtime"
    extract_root = runtime_root / "motionview-pros"
    stamp_path = extract_root / ".archive-mtime"
    expected_exe = extract_root / "motionview-pros" / f"motionview-pros{exe_ext}"
    archive_mtime = str(int(archive_path.stat().st_mtime))

    try:
        current_stamp = stamp_path.read_text(encoding="utf-8").strip() if stamp_path.exists() else None
        needs_extract = current_stamp != archive_mtime or not expected_exe.exists()
        if needs_extract:
            if extract_root.exists():
                shutil.rmtree(extract_root, ignore_errors=True)
            extract_root.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(extract_root)
            if platform.system() != "Windows":
                try:
                    executable = extract_root / "motionview-pros" / f"motionview-pros{exe_ext}"
                    if executable.exists():
                        executable.chmod(executable.stat().st_mode | 0o755)
                except Exception:
                    pass
            stamp_path.write_text(archive_mtime, encoding="utf-8")
        if expected_exe.exists() and expected_exe.is_file():
            if platform.system() != "Windows":
                try:
                    expected_exe.chmod(expected_exe.stat().st_mode | 0o755)
                except Exception:
                    pass
            return str(expected_exe.resolve())
    except Exception:
        return None
    return None

def resolve_extracted_pros_exe() -> Optional[str]:
    exe_ext = ".exe" if platform.system() == "Windows" else ""
    runtime_root = motionview_support_dir() / "Runtime" / "motionview-pros"
    candidates = [
        runtime_root / "motionview-pros" / f"motionview-pros{exe_ext}",
        runtime_root / f"motionview-pros{exe_ext}",
    ]

    for candidate in candidates:
        try:
            resolved = candidate.expanduser().resolve()
        except Exception:
            continue
        if resolved.exists() and resolved.is_file():
            if platform.system() != "Windows":
                try:
                    resolved.chmod(resolved.stat().st_mode | 0o755)
                except Exception:
                    pass
            return str(resolved)
    return None

def resolve_pros_exe() -> Optional[str]:
    return resolve_extracted_pros_exe() or resolve_bundled_pros_exe()

# MotionView must use the bundled MVLib-compatible PROS fork.
PROS_EXE = resolve_pros_exe()
if not PROS_EXE:
    print("[WARN] Bundled MotionView PROS CLI not found. Live streaming may not work.", file=sys.stderr)
# Resource paths (PyInstaller-friendly)
# ----------------------------
def resource_base_dir() -> Path:
    """
    When bundled with PyInstaller onefile, assets land in sys._MEIPASS.
    Otherwise use the script directory.
    """
    if hasattr(sys, "_MEIPASS"):
        return Path(getattr(sys, "_MEIPASS")).resolve()
    return Path(__file__).resolve().parent

# Matches common ANSI escape sequences:
# - CSI: ESC [ ... command
# - OSC: ESC ] ... BEL or ST (ESC \)
# - 2-char escapes: ESC <char>
_ANSI_RE = re.compile(
    r"""
    \x1B  # ESC
    (?:
        \[[0-?]*[ -/]*[@-~]            # CSI ... Cmd
      | \][^\x07]*(?:\x07|\x1B\\)      # OSC ... BEL or ST
      | [@-Z\\-_]                      # 2-char sequences
    )
    """,
    re.VERBOSE,
)

def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s)

BASE_DIR = resource_base_dir()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG_PATH = os.environ.get("MOTIONVIEW_LOG_PATH")

def _append_log(line: str) -> None:
    if not LOG_PATH:
        return
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line.rstrip("\n") + "\n")
    except Exception:
        pass

def log_line(level: str, msg: str, tag: Optional[str] = None) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    t = f"[{tag}] " if tag else ""
    _append_log(f"{ts} [{level}] {t}{msg}")


# ----------------------------
# WebSocket clients + broadcast
# ----------------------------
clients: Set[WebSocket] = set()
_clients_lock = asyncio.Lock()

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with _clients_lock:
        clients.add(websocket)
    try:
        # Keep alive: some clients send pings; if not, this just waits.
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        async with _clients_lock:
            clients.discard(websocket)

async def broadcast(line: str):
    line = strip_ansi(line)
    # Take useless lines and remove them
    if "resolve_v5_port - No v5 ports were found" in line:
        line = "No v5 devices were found."
    elif "PROS-CLI Version: " in line:
        return
    elif "Usage: pros terminal [OPTIONS] [PORT]" in line:
        return
    elif "Try 'pros terminal --help' for help" in line:
        return
    elif ("Press Ctrl" in line
        or "Sentry is attempting to send" in line
        or "Waiting up to" in line):
        return
    elif "You must be in a PROS project directory" in line:
        line = "The PROS Path selected is not inside of a PROS Project."
    elif "Couldn't find the response header in the device response after" in line:
        line = "Connected device disconnected."
    elif "The PROS Path selected is not inside of a PROS Project" in line:
        line = "The PROS Path selected is not inside of a PROS Project."
    elif ("NotOpenSSLWarning" in line
        or "RequestsDependencyWarning" in line
        or "currently the 'ssl' module is compiled with 'LibreSSL" in line
        or "Unable to find acceptable character detection dependency" in line):
        return

    async with _clients_lock:
        current = list(clients)

    dead = []
    for ws in current:
        try:
            await ws.send_text(line)
        except Exception:
            dead.append(ws)

    if dead:
        async with _clients_lock:
            for ws in dead:
                clients.discard(ws)


# ----------------------------
# PROS terminal process manager
# ----------------------------
class ProsTerminalRunner:
    def __init__(self):
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.reader_task: Optional[asyncio.Task] = None
        self._op_lock = asyncio.Lock()

        # Unix PTY support
        self._pty_master_fd: Optional[int] = None
        self._pty_buf: bytes = b""
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    @property
    def pid(self) -> Optional[int]:
        return None if self.proc is None else self.proc.pid

    async def start(self) -> dict:
        async with self._op_lock:
            if self.running:
                return {"ok": True, "status": "already running", "pid": self.pid}

            self._loop = asyncio.get_running_loop()

            # If a previous session exited without cleanup, clear stale PTY/reader state.
            if self._loop is not None and self._pty_master_fd is not None:
                try:
                    self._loop.remove_reader(self._pty_master_fd)
                except Exception:
                    pass
                try:
                    os.close(self._pty_master_fd)
                except Exception:
                    pass
                self._pty_master_fd = None
                self._pty_buf = b""

            try:
                await asyncio.wait_for(self._start_pipes(), timeout=3.0)
                return {"ok": True, "status": "started", "pid": self.pid, "mode": "pipes"}
            except Exception as e:
                if os.name != "nt":
                    try:
                        await asyncio.wait_for(self._start_unix_pty(), timeout=3.0)
                        return {"ok": True, "status": "started", "pid": self.pid, "mode": "pty"}
                    except Exception as pty_error:
                        return {"ok": False, "status": f"start failed: pipes={e}; pty={pty_error}"}
                return {"ok": False, "status": f"start failed: {e}"}

    async def stop(self) -> dict:
        async with self._op_lock:
            if not self.running:
                # Still clean up stale PTY/reader state if present.
                if self.proc is None and self.reader_task is None and self._pty_master_fd is None:
                    return {"ok": True, "status": "not running"}
                try:
                    await asyncio.wait_for(self._terminate(graceful=True), timeout=3.0)
                    return {"ok": True, "status": "cleaned"}
                except Exception as e:
                    return {"ok": False, "status": f"stop failed: {e}"}

            try:
                await asyncio.wait_for(self._terminate(graceful=True), timeout=3.0)
                return {"ok": True, "status": "stopped"}
            except Exception as e:
                return {"ok": False, "status": f"stop failed: {e}"}

    async def kill(self) -> dict:
        async with self._op_lock:
            if not self.running:
                return {"ok": True, "status": "not running"}

            try:
                await asyncio.wait_for(self._terminate(graceful=False), timeout=3.0)
                return {"ok": True, "status": "killed"}
            except Exception as e:
                return {"ok": False, "status": f"kill failed: {e}"}

    async def _terminate(self, graceful: bool):
        # Stop reader first (so it doesn't race against FD close)
        if self.reader_task:
            self.reader_task.cancel()
            try:
                await self.reader_task
            except Exception:
                pass
            self.reader_task = None

        # Close PTY reader hook + fds on Unix
        if self._loop is not None and self._pty_master_fd is not None:
            try:
                self._loop.remove_reader(self._pty_master_fd)
            except Exception:
                pass
        if self._pty_master_fd is not None:
            try:
                os.close(self._pty_master_fd)
            except Exception:
                pass
            self._pty_master_fd = None
            self._pty_buf = b""

        proc = self.proc
        self.proc = None
        if proc is None:
            return

        # Try graceful termination
        try:
            if graceful:
                if os.name != "nt":
                    # Terminate the whole process group if we started it that way.
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except Exception:
                        proc.terminate()
                else:
                    try:
                        import subprocess
                        subprocess.run(
                            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                            check=False,
                        )
                    except Exception:
                        proc.terminate()
            else:
                if os.name != "nt":
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except Exception:
                        proc.kill()
                else:
                    try:
                        import subprocess
                        subprocess.run(
                            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                            check=False,
                        )
                    except Exception:
                        proc.kill()
        except Exception:
            pass

        # Wait a bit, then kill if needed
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0 if graceful else 0.5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=1.0)
            except:
                pass
        except Exception:
            pass

    async def _start_unix_pty(self):
        import pty  # Unix only

        if self._loop is None:
            self._loop = asyncio.get_running_loop()

        master_fd, slave_fd = pty.openpty()
        self._pty_master_fd = master_fd
        self._pty_buf = b""

        # On Unix, start a new process group so we can terminate the group cleanly
        def _preexec():
            os.setsid()

        # Get current PROS_PROJECT_DIR (may have been updated)
        lock = _get_lock()
        async with lock:
            pros_dir = str(PROS_PROJECT_DIR)
        env = os.environ.copy()
        env["MOTIONVIEW_HEADLESS"] = "1"
        # Spawn `pros terminal` with stdio attached to PTY slave
        self.proc = await asyncio.create_subprocess_exec(
            PROS_EXE, "terminal", "--no-banner",
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=_preexec,
            cwd=pros_dir,
            env=env,
        )

        # Parent closes slave; we only read from master
        try:
            os.close(slave_fd)
        except Exception:
            pass

        # Add readable callback for PTY master
        self._loop.add_reader(master_fd, self._on_pty_data_ready)

    def _on_pty_data_ready(self):
        if self._pty_master_fd is None or self._loop is None:
            return
        try:
            data = os.read(self._pty_master_fd, 4096)
        except OSError:
            try:
                self._loop.remove_reader(self._pty_master_fd)
            except Exception:
                pass
            try:
                os.close(self._pty_master_fd)
            except Exception:
                pass
            self._pty_master_fd = None
            self._pty_buf = b""
            return
        if not data:
            # EOF: remove reader to avoid busy loop, and close master.
            try:
                self._loop.remove_reader(self._pty_master_fd)
            except Exception:
                pass
            try:
                os.close(self._pty_master_fd)
            except Exception:
                pass
            self._pty_master_fd = None
            self._pty_buf = b""
            return

        self._pty_buf += data
        while b"\n" in self._pty_buf:
            raw, self._pty_buf = self._pty_buf.split(b"\n", 1)
            line = raw.decode("utf-8", errors="replace").rstrip("\r").strip()
            if line:
                self._loop.create_task(broadcast(line))

    async def _start_pipes(self):
        creationflags = 0
        if os.name == "nt":
            # Keep it in its own process group to make termination more reliable
            try:
                import subprocess
                creationflags = (
                    subprocess.CREATE_NEW_PROCESS_GROUP
                    | subprocess.CREATE_NO_WINDOW
                )
            except Exception:
                creationflags = 0

        # Get current PROS_PROJECT_DIR (may have been updated)
        lock = _get_lock()
        async with lock:
            pros_dir = str(PROS_PROJECT_DIR)
        env = os.environ.copy()
        env["MOTIONVIEW_HEADLESS"] = "1"
        self.proc = await asyncio.create_subprocess_exec(
            PROS_EXE, "terminal", "--no-banner",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.DEVNULL,
            cwd=pros_dir,
            creationflags=creationflags,
            env=env,
        )
        print(f"runner._start_pipes: proc started pid={self.proc.pid}", file=sys.stderr)

        self.reader_task = asyncio.create_task(self._read_pipe_output())

    async def _read_pipe_output(self):
        assert self.proc is not None
        if self.proc.stdout is None:
            return

        while True:
            line = await self.proc.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip("\r\n")
            if text.strip():
                await broadcast(text)


runner = ProsTerminalRunner()


# ----------------------------
# API endpoints
# ----------------------------
@app.on_event("shutdown")
async def _shutdown():
    # Ensure child process is cleaned up when server exits
    try:
        await runner.stop()
    except Exception:
        pass

@app.post("/api/start")
async def api_start():
    try:
        return await runner.start()
    except FileNotFoundError:
        return {"ok": False, "status": "Bundled MotionView PROS CLI not found"}
    except Exception as e:
        return {"ok": False, "status": f"start failed: {e}"}

@app.post("/api/stop")
async def api_stop():
    try:
        return await runner.stop()
    except Exception as e:
        return {"ok": False, "status": f"stop failed: {e}"}

@app.post("/api/kill")
async def api_kill():
    try:
        return await runner.kill()
    except Exception as e:
        return {"ok": False, "status": f"kill failed: {e}"}

class LogMessage(BaseModel):
    level: str = "INFO"
    message: str
    tag: Optional[str] = None

@app.post("/api/log")
async def api_log(msg: LogMessage):
    try:
        log_line(msg.level.upper(), msg.message, msg.tag)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "status": f"log failed: {e}"}

@app.get("/api/status")
async def api_status():
    lock = _get_lock()
    async with lock:
        pros_dir = str(PROS_PROJECT_DIR)
    return {
        "running": runner.running,
        "pid": runner.pid,
        "clients": len(clients),
        "pros_dir": pros_dir,
        "log_path": str(LOG_PATH) if LOG_PATH else None,
    }

@app.get("/api/pros-dir")
async def api_get_pros_dir():
    """Get the current PROS project directory."""
    lock = _get_lock()
    async with lock:
        return {"ok": True, "dir": str(PROS_PROJECT_DIR)}

def _search_roots_for_pros() -> List[Path]:
    home = Path.home()
    roots = [
        home / "Documents",
        home / "Desktop",
        home / "Projects",
        home / "Code",
        home / "pros",
    ]
    return [r for r in roots if r.exists() and r.is_dir()]

def _find_pros_projects(max_depth: int = 4, max_results: int = 10, time_budget_s: float = 1.5) -> List[str]:
    """
    Find directories containing a PROS project (project.pros) under common roots.
    Bounded by depth, results, and a short time budget to keep UI responsive.
    """
    results: List[str] = []
    start = time.time()
    for root in _search_roots_for_pros():
        for dirpath, dirnames, filenames in os.walk(root):
            if time.time() - start > time_budget_s:
                return results
            depth = len(Path(dirpath).relative_to(root).parts)
            if depth > max_depth:
                dirnames[:] = []
                continue
            if "project.pros" in filenames:
                results.append(str(Path(dirpath).resolve()))
                if len(results) >= max_results:
                    return results
    return results

@app.get("/api/pros-dir/auto")
async def api_auto_pros_dir():
    """Auto-detect PROS projects and return candidates."""
    try:
        candidates = _find_pros_projects()
        return {"ok": True, "candidates": candidates}
    except Exception as e:
        return {"ok": False, "status": f"error: {e}", "candidates": []}

@app.post("/api/pros-dir")
async def api_set_pros_dir(request: Request):
    """Set the PROS project directory. Expects JSON body with 'dir' field."""
    try:
        body = await request.json()
        dir_path = body.get("dir")
        
        if not dir_path:
            return {"ok": False, "status": "missing 'dir' field"}
        
        path = Path(dir_path).expanduser().resolve()
        if not path.exists():
            return {"ok": False, "status": f"path does not exist: {path}"}
        if not path.is_dir():
            return {"ok": False, "status": f"path is not a directory: {path}"}
        
        lock = _get_lock()
        async with lock:
            global PROS_PROJECT_DIR
            PROS_PROJECT_DIR = path
        
        return {"ok": True, "dir": str(PROS_PROJECT_DIR)}
    except Exception as e:
        return {"ok": False, "status": f"error: {e}"}


# ----------------------------
# Entrypoint
# ----------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, ws="websockets")

if __name__ == "__main__":
    main()
