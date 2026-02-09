use std::{
  net::TcpListener,
  path::PathBuf,
  process::{Child, Command},
  sync::Mutex,
};
use tauri::{Manager, RunEvent};

struct BridgeState(Mutex<Option<Child>>);

fn pick_free_port() -> u16 {
  let l = TcpListener::bind(("127.0.0.1", 0)).expect("bind 127.0.0.1:0");
  l.local_addr().unwrap().port()
}

fn venv_python(root: &PathBuf) -> Option<PathBuf> {
  let p = if cfg!(target_os = "windows") {
    root.join(".venv").join("Scripts").join("python.exe")
  } else {
    root.join(".venv").join("bin").join("python")
  };
  p.exists().then_some(p)
}

fn find_project_root() -> PathBuf {
  let mut dir = std::env::current_dir().expect("current_dir");
  loop {
    if dir.join("package.json").exists() && dir.join("pnpm-lock.yaml").exists() {
      return dir;
    }
    if !dir.pop() {
      panic!("Could not find project root (package.json not found in any parent)");
    }
  }
}

fn spawn_bridge(root: &PathBuf, port: u16) -> Child {
  let script = root.join("src").join("bridge.py");

  let mut cmd = if let Some(py) = venv_python(root) {
    Command::new(py)
  } else if cfg!(target_os = "windows") {
    let mut c = Command::new("py");
    c.arg("-3");
    c
  } else {
    Command::new("python3")
  };

  println!("Spawning bridge: {:?} --host 127.0.0.1 --port {}", script, port);

  cmd.arg(script)
    .args(["--host", "127.0.0.1", "--port", &port.to_string()])
    .current_dir(root.join("src")) // <-- so relative paths in bridge resolve to src/
    .spawn()
    .expect("spawn bridge.py")
}

fn main() {
  tauri::Builder::default()
    .manage(BridgeState(Mutex::new(None)))
    .setup(|app| {
      let port = pick_free_port();
      let root = find_project_root();

      let child = spawn_bridge(&root, port);
      *app.state::<BridgeState>().0.lock().unwrap() = Some(child);

      // Tell frontend where backend is
      if let Some(win) = app.get_webview_window("main") {
        win.eval(&format!(
          "window.__BRIDGE_ORIGIN__ = 'http://127.0.0.1:{port}';"
        ))?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error building tauri app")
    .run(|app_handle, event| {
      if let RunEvent::ExitRequested { .. } = event {
        if let Some(mut child) = app_handle.state::<BridgeState>().0.lock().unwrap().take() {
          let _ = child.kill();
        }
      }
    });
}
