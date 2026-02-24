#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{Manager, RunEvent, Window};
mod settings;

struct BridgeState(Mutex<Option<Child>>);

fn pick_free_port() -> u16 {
    let l = TcpListener::bind(("127.0.0.1", 0)).expect("bind 127.0.0.1:0");
    l.local_addr().unwrap().port()
}

fn resolve_bridge_bin(app: &tauri::AppHandle) -> tauri::Result<std::path::PathBuf> {
    // Build candidate file names: triple-suffixed (dev) and plain (bundled).
    let mut names: Vec<String> = Vec::new();
    if let Some(triple) = option_env!("TAURI_ENV_TARGET_TRIPLE") {
        names.push(format!(
            "motionview-py-{}{}",
            triple,
            if cfg!(target_os = "windows") { ".exe" } else { "" }
        ));
    }
    names.push(format!(
        "motionview-py{}",
        if cfg!(target_os = "windows") { ".exe" } else { "" }
    ));

    // Allow an explicit override for diagnostics or custom deployments.
    if let Ok(force) = std::env::var("MOTIONVIEW_BRIDGE_BIN") {
        let p = std::path::PathBuf::from(force);
        println!("CHECKING BIN PATH (override): {:?}", p);
        if p.exists() {
            return Ok(p);
        }
    }

    // Collect search roots in priority order:
    // 1) Dev bin/ (when running from source; skipped in release builds)
    // 2) Bundled Resources/bin (Tauri default for externalBin)
    // 3) Bundled executable directory (macOS puts externalBin in Contents/MacOS)
    // 4) Bundled executable directory + bin/ (Windows MSI often flattens)
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if cfg!(debug_assertions) {
        roots.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin"));
    }
    if let Ok(res_root) = app
        .path()
        .resolve("", tauri::path::BaseDirectory::Resource)
        .map(|p| p.join("bin"))
    {
        roots.push(res_root);
    }
    if let Ok(mut exe_dir) = std::env::current_exe().and_then(|p| {
        p.parent()
            .map(|p| p.to_path_buf())
            .ok_or(std::io::Error::new(std::io::ErrorKind::Other, "no exe parent"))
    }) {
        // Where the main exe lives (e.g., Contents/MacOS or AppData/Local/MotionView/__up__)
        roots.push(exe_dir.clone());

        // A bin/ next to the exe (some installers flatten to a bin folder)
        roots.push(exe_dir.join("bin"));

        // Also look one level up, because Windows installers sometimes place
        // sidecars beside the app root while the exe is under __up__/.
        if let Some(parent) = exe_dir.parent() {
            roots.push(parent.to_path_buf());
            roots.push(parent.join("bin"));
            roots.push(parent.join("__up__"));
            roots.push(parent.join("__up__").join("bin"));

            // Windows MSI often installs the exe under AppData\\Local\\Programs\\<App>,
            // while external resources may land in AppData\\Local\\<App>. Walk one level
            // higher and look for a sibling MotionView folder as well.
            if let Some(grand) = parent.parent() {
                roots.push(grand.join("MotionView"));
                roots.push(grand.join("MotionView").join("bin"));
            }
        }
    }

    for root in roots {
        for name in &names {
            let candidate = root.join(name);
            println!("CHECKING BIN PATH: {:?}", candidate);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(tauri::Error::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "bridge binary not found in dev bin/, resources/bin, exe dir, or exe dir/bin",
    )))
}

#[cfg(unix)]
fn format_log_ts() -> String {
    use libc::{localtime_r, time, tm};
    unsafe {
        let mut t: libc::time_t = 0;
        time(&mut t as *mut libc::time_t);
        let mut out: tm = std::mem::zeroed();
        if localtime_r(&t as *const libc::time_t, &mut out as *mut tm).is_null() {
            return format!("{}", t);
        }
        let year = (out.tm_year + 1900) % 100;
        format!(
            "{:02}_{:02}_{:02}-{:02}_{:02}_{:02}",
            out.tm_mon + 1,
            out.tm_mday,
            year,
            out.tm_hour,
            out.tm_min,
            out.tm_sec
        )
    }
}

#[cfg(not(unix))]
fn format_log_ts() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", ts)
}

fn stop_bridge(state: &tauri::State<BridgeState>, app: &tauri::AppHandle) {
    if let Some(mut child) = state.0.lock().unwrap().take() {
        #[cfg(unix)]
        {
            let pid = child.id() as i32;
            // Try graceful stop of the process group first
            let _ = Command::new("kill")
                .arg("-TERM")
                .arg(format!("-{}", pid))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            // Ensure the process group is gone
            let _ = Command::new("kill")
                .arg("-KILL")
                .arg(format!("-{}", pid))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }
        // Reap in background to avoid blocking the main thread.
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
    if let Ok(path) = pid_path(app) {
        let _ = fs::remove_file(path);
    }
}

fn pid_path(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    app.path().app_data_dir().map(|dir| dir.join("bridge.pid"))
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    let _ = Command::new("kill")
        .arg("-TERM")
        .arg(format!("-{}", pid))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("kill")
        .arg("-KILL")
        .arg(format!("-{}", pid))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn cleanup_previous_bridge(app: &tauri::AppHandle) {
    let path = match pid_path(app) {
        Ok(p) => p,
        Err(_) => return,
    };
    let pid_str = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return,
    };
    if let Ok(pid) = pid_str.trim().parse::<u32>() {
        kill_pid(pid);
    }
    let _ = fs::remove_file(path);
}

fn write_bridge_pid(app: &tauri::AppHandle, pid: u32) {
    if let Ok(path) = pid_path(app) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, pid.to_string());
    }
}

fn spawn_bridge(app: &tauri::AppHandle, port: u16) -> Result<std::process::Child, tauri::Error> {
    // Resolve the Sidecar Binary Path
    let exe = resolve_bridge_bin(app).map_err(|e| {
        eprintln!("BRIDGE ERROR: Could not resolve binary: {}", e);
        e
    })?;

    // Setup Logging Directory and File
    // We use app_data_dir, falling back to project root/logs if that fails
    let log_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap().join("logs"));

    // Create the directory if it doesn't exist
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!(
            "BRIDGE ERROR: Failed to create log directory {:?}: {}",
            log_dir, e
        );
    }

    let ts = format_log_ts();
    let log_path = log_dir.join(format!("{ts}.log"));

    // Open the log file
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| {
            eprintln!(
                "BRIDGE ERROR: Failed to open log file {:?}: {}",
                log_path, e
            );
            tauri::Error::Io(e)
        })?;

    let log_err = log.try_clone().map_err(tauri::Error::Io)?;

    // Prepare Command
    let mut cmd = std::process::Command::new(&exe);

    #[cfg(windows)]
    {
      const CREATE_NO_WINDOW: u32 = 0x08000000;
      cmd.creation_flags(CREATE_NO_WINDOW);
    }
    
    // Apply Unix-specific process grouping (ignored on Windows)
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    // Spawn
    println!("SPAWNING BRIDGE: {:?} on port {}", exe, port);

    cmd.args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .env("MOTIONVIEW_LOG_PATH", &log_path)
        .stdout(std::process::Stdio::from(log))
        .stderr(std::process::Stdio::from(log_err))
        .spawn()
        .map_err(|e| {
            eprintln!("BRIDGE ERROR: Failed to spawn process: {}", e);
            tauri::Error::Io(e)
        })
}

#[tauri::command]
fn set_windows_fullscreen(window: Window, enable: bool) -> Result<bool, String> {
    if cfg!(target_os = "windows") {
        window.set_fullscreen(enable).map_err(|e| e.to_string())?;
    }
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_window_fullscreen_state(window: Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[cfg(not(mobile))]
fn persist_window_state(app_handle: &tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window("main") {
        if let Err(err) = settings::save_window_state(app_handle, &win) {
            eprintln!("Failed to save window state: {err}");
        }
    }
}

#[cfg(mobile)]
fn persist_window_state(_: &tauri::AppHandle) {}

fn main() {
  println!("DO NOT CLOSE THIS WINDOW. MotionView runs off of it and cannot function without this window open.");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BridgeState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            settings::read_settings,
            settings::write_settings,
            settings::read_image_data,
            settings::save_robot_image,
            settings::read_saved_paths,
            settings::write_saved_paths,
            set_windows_fullscreen,
            get_window_fullscreen_state
        ])
        .setup(|app| {
            cleanup_previous_bridge(app.handle());
            let port = pick_free_port();
            let child = spawn_bridge(app.handle(), port)?;
            write_bridge_pid(app.handle(), child.id());
            *app.state::<BridgeState>().0.lock().unwrap() = Some(child);

            // Tell frontend where backend is
            if let Some(win) = app.get_webview_window("main") {
                win.eval(&format!(
                    "window.__BRIDGE_ORIGIN__ = 'http://127.0.0.1:{port}';"
                ))?;

                #[cfg(not(mobile))]
                {
                    if let Ok(Some(state)) = settings::read_window_state(app.handle()) {
                        if state.fullscreen {
                            let _ = win.set_fullscreen(true);
                        } else {
                            let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                                state.width,
                                state.height,
                            )));
                            let _ = win.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(state.x, state.y),
                            ));
                        }
                    }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app_handle, event| {
            match event {
                // Fires when any window is closed/destroyed (covers clicking the red X)
                RunEvent::WindowEvent { label, event, .. } => {
                    if label == "main" {
                        match event {
                            tauri::WindowEvent::CloseRequested { .. } => {
                                persist_window_state(&app_handle);
                            }
                            tauri::WindowEvent::Destroyed => {
                                persist_window_state(&app_handle);
                                stop_bridge(&app_handle.state::<BridgeState>(), app_handle);
                            }
                            _ => {}
                        }
                    }
                }

                // Fires when the app is exiting normally
                RunEvent::Exit => {
                    persist_window_state(&app_handle);
                    stop_bridge(&app_handle.state::<BridgeState>(), app_handle);
                }

                // Fires on quit requests (Cmd+Q / Dock Quit / menu Quit)
                RunEvent::ExitRequested { .. } => {
                    persist_window_state(&app_handle);
                    stop_bridge(&app_handle.state::<BridgeState>(), app_handle);
                }

                _ => {}
            }
        });
}
