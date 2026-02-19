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

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.websockets import WebSocket
from starlette.middleware.cors import CORSMiddleware
import uvicorn

# PROS_PROJECT_DIR can be updated via API
PROS_PROJECT_DIR = None
# Lock will be created when needed (can't create Lock outside async context)
PROS_PROJECT_DIR_LOCK = None

# Optional override for PROS executable
PROS_EXE_OVERRIDE = None
PROS_EXE_LOCK = None

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

def _get_pros_exe_lock():
    """Get or create the lock for PROS_EXE_OVERRIDE updates."""
    global PROS_EXE_LOCK
    if PROS_EXE_LOCK is None:
        try:
            PROS_EXE_LOCK = asyncio.Lock()
        except RuntimeError:
            PROS_EXE_LOCK = asyncio.Lock()
    return PROS_EXE_LOCK

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

def resolve_pros_exe() -> Optional[str]:
    # Prefer explicit override, then VS Code-managed PROS, then PATH lookup
    if PROS_EXE_OVERRIDE:
        return str(PROS_EXE_OVERRIDE)
    return configure_pros_env_from_vscode() or shutil.which("pros") or shutil.which("pros.exe")

# Prefer VS Code-managed PROS if present; else fall back to PATH lookup
PROS_EXE = resolve_pros_exe()
if not PROS_EXE:
    print("[WARN] PROS CLI not found on PATH or VS Code install. Live streaming may not work.", file=sys.stderr)

def _find_pros_executables() -> List[str]:
    sysname = platform.system()
    candidates: List[Path] = []

    for base in _candidate_vscode_install_bases():
        if sysname == "Darwin":
            candidates.append(base / "pros-cli-macos" / "pros")
        elif sysname == "Windows":
            candidates.append(base / "pros-cli-windows" / "pros.exe")
        else:
            candidates.append(base / "pros-cli-linux" / "pros")

    # PATH lookup
    p = shutil.which("pros") or shutil.which("pros.exe")
    if p:
        candidates.append(Path(p))

    # Common locations (best-effort)
    if sysname == "Darwin":
        candidates += [Path("/usr/local/bin/pros"), Path("/opt/homebrew/bin/pros")]
    elif sysname == "Linux":
        candidates += [Path("/usr/local/bin/pros"), Path("/usr/bin/pros")]

    out: List[str] = []
    seen = set()
    for c in candidates:
        try:
            cp = c.expanduser().resolve()
        except Exception:
            continue
        if not cp.exists() or not cp.is_file():
            continue
        s = str(cp)
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out
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
VIEWER_HTML = BASE_DIR / "Viewer.html"
ASSETS_DIR = BASE_DIR / "assets"
ROBOT_IMG = BASE_DIR / "robot_image.png"


# ----------------------------
# App + static serving
# ----------------------------
app = FastAPI()

# If you load the UI from Tauri's bundled files (tauri://localhost) instead of from this server,
# you may need CORS. Since we bind to 127.0.0.1, allowing all origins is usually OK.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
else:
    print(f"WARNING: assets dir not found at {ASSETS_DIR}")

@app.get("/")
async def index():
    if VIEWER_HTML.exists() and VIEWER_HTML.is_file():
        return FileResponse(str(VIEWER_HTML))
    return Response(status_code=404)          

@app.get("/robot_image.png")
async def robot_image():
    if ROBOT_IMG.exists() and ROBOT_IMG.is_file():
        return FileResponse(str(ROBOT_IMG))
    return Response(status_code=404)


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
    if "resolve_v5_port - No v5 ports were found" in line:
        line = "No v5 devices were found."
    elif (
        "Sentry is attempting to send" in line
        or "Waiting up to" in line
        or "Press Ctrl-C to quit" in line
    ):
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
        if self.running:
            return {"ok": True, "status": "already running", "pid": self.pid}

        self._loop = asyncio.get_running_loop()

        # Prefer PTY on Unix-like systems
        if os.name != "nt":
            try:
                await self._start_unix_pty()
                return {"ok": True, "status": "started", "pid": self.pid, "mode": "pty"}
            except Exception as e:
                # Fall back to pipes if PTY fails
                print(f"WARNING: PTY start failed, falling back to pipes: {e}")

        await self._start_pipes()
        return {"ok": True, "status": "started", "pid": self.pid, "mode": "pipes"}

    async def stop(self) -> dict:
        if not self.running:
            return {"ok": True, "status": "not running"}

        await self._terminate(graceful=True)
        return {"ok": True, "status": "stopped"}

    async def kill(self) -> dict:
        if not self.running:
            return {"ok": True, "status": "not running"}

        await self._terminate(graceful=False)
        return {"ok": True, "status": "killed"}

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
                    proc.terminate()
            else:
                if os.name != "nt":
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except Exception:
                        proc.kill()
                else:
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
        os.system(f"cd {pros_dir}")
        # Spawn `pros terminal` with stdio attached to PTY slave
        self.proc = await asyncio.create_subprocess_exec(
            PROS_EXE, "terminal",
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=_preexec,
            cwd=pros_dir
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
            return
        if not data:
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
                creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
            except Exception:
                creationflags = 0

        # Get current PROS_PROJECT_DIR (may have been updated)
        lock = _get_lock()
        async with lock:
            pros_dir = str(PROS_PROJECT_DIR)
        self.proc = await asyncio.create_subprocess_exec(
            PROS_EXE, "terminal",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.DEVNULL,
            cwd=pros_dir,
            creationflags=creationflags,
        )

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
        return {"ok": False, "status": "`pros` not found on PATH"}
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

@app.get("/api/status")
async def api_status():
    lock = _get_lock()
    async with lock:
        pros_dir = str(PROS_PROJECT_DIR)
    return {
        "running": runner.running,
        "pid": runner.pid,
        "clients": len(clients),
        "assets_dir": str(ASSETS_DIR),
        "viewer_html": str(VIEWER_HTML),
        "pros_dir": pros_dir,
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

@app.get("/api/pros-exe")
async def api_get_pros_exe():
    exe = resolve_pros_exe()
    if exe:
        return {"ok": True, "path": exe}
    return {"ok": False, "status": "pros executable not found"}

@app.post("/api/pros-exe")
async def api_set_pros_exe(request: Request):
    """Set the PROS CLI executable path. Expects JSON body with 'path' field."""
    try:
        body = await request.json()
        path_str = body.get("path")
        if not path_str:
            return {"ok": False, "status": "missing 'path' field"}
        path = Path(path_str).expanduser().resolve()
        if not path.exists():
            return {"ok": False, "status": f"path does not exist: {path}"}
        if not path.is_file():
            return {"ok": False, "status": f"path is not a file: {path}"}

        lock = _get_pros_exe_lock()
        async with lock:
            global PROS_EXE_OVERRIDE, PROS_EXE
            PROS_EXE_OVERRIDE = path
            PROS_EXE = str(path)
        return {"ok": True, "path": str(path)}
    except Exception as e:
        return {"ok": False, "status": f"error: {e}"}

@app.get("/api/pros-exe/auto")
async def api_auto_pros_exe():
    try:
        candidates = _find_pros_executables()
        return {"ok": True, "candidates": candidates}
    except Exception as e:
        return {"ok": False, "status": f"error: {e}", "candidates": []}


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
