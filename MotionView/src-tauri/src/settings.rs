use std::path::PathBuf;

use base64::Engine as _;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "user-preferences.json";
const ROBOT_IMAGE_FILE_BASE: &str = "robot-image";
const SAVED_PATHS_FILE: &str = "saved-paths.json";
#[cfg(not(mobile))]
#[allow(dead_code)]
const WINDOW_STATE_FILE: &str = "window-state.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE))
}

fn legacy_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE))
}

fn saved_paths_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SAVED_PATHS_FILE))
}

#[cfg(not(mobile))]
#[allow(dead_code)]
fn window_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(WINDOW_STATE_FILE))
}

#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    if path.exists() {
        return std::fs::read_to_string(path)
            .map(Some)
            .map_err(|e| e.to_string());
    }

    let legacy_path = legacy_settings_path(&app)?;
    if !legacy_path.exists() {
        return Ok(None);
    }

    let contents = std::fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    // Best-effort migration to the new location.
    if let Some(parent) = path.parent() {
        if std::fs::create_dir_all(parent).is_ok() {
            if std::fs::write(&path, &contents).is_ok() {
                let _ = std::fs::remove_file(&legacy_path);
            }
        }
    }
    Ok(Some(contents))
}

#[tauri::command]
pub fn write_settings(app: AppHandle, contents: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| e.to_string())?;
    let path = settings_path(&app)?;
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_saved_paths(app: AppHandle) -> Result<Option<String>, String> {
    let path = saved_paths_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_saved_paths(app: AppHandle, contents: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| e.to_string())?;
    let path = saved_paths_path(&app)?;
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

fn mime_from_ext(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn ext_from_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

fn parse_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (meta, b64) = data_url
        .split_once(',')
        .ok_or_else(|| "invalid data URL".to_string())?;
    if !meta.starts_with("data:") || !meta.contains(";base64") {
        return Err("invalid data URL header".into());
    }
    let mime = meta
        .strip_prefix("data:")
        .and_then(|m| m.split(';').next())
        .filter(|m| !m.is_empty())
        .ok_or_else(|| "missing mime type".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    Ok((mime.to_string(), bytes))
}

#[tauri::command]
pub fn read_image_data(path: String) -> Result<String, String> {
    let p = std::path::PathBuf::from(path);
    if !p.exists() {
        return Err("image path does not exist".into());
    }
    if !p.is_file() {
        return Err("image path is not a file".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let mime = mime_from_ext(&p);
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn save_robot_image(app: AppHandle, dataUrl: String) -> Result<String, String> {
    let (mime, bytes) = parse_data_url(&dataUrl)?;
    let ext = ext_from_mime(&mime);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!("{ROBOT_IMAGE_FILE_BASE}.{ext}");
    let path = dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(not(mobile))]
#[allow(dead_code)]
pub fn save_window_state(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let payload = serde_json::json!({
        "x": pos.x,
        "y": pos.y,
        "width": size.width,
        "height": size.height,
        "fullscreen": fullscreen
    });
    let path = window_state_path(app)?;
    let contents = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(not(mobile))]
#[derive(serde::Deserialize)]
#[warn(dead_code)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
}

#[cfg(not(mobile))]
#[allow(dead_code)]
pub fn read_window_state(app: &AppHandle) -> Result<Option<WindowState>, String> {
    let path = window_state_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let state: WindowState = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(Some(state))
}
