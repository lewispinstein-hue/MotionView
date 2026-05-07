use std::path::PathBuf;
use std::{collections::HashMap, fs};

use base64::Engine as _;
use semver::Version;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "user-preferences.json";
const ROBOT_IMAGE_FILE_BASE: &str = "robot-image";
const SAVED_PATHS_FILE: &str = "saved-paths.json";
#[cfg(not(mobile))]
#[allow(dead_code)]
const WINDOW_STATE_FILE: &str = "window-state.json";
const AUX_WINDOW_STATE_FILE: &str = "aux-window-state.json";
const APP_STATE_KEY: &str = "appState";
const LAST_SEEN_APP_VERSION_KEY: &str = "lastSeenAppVersion";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousVersionStatus {
    pub previous_version: Option<String>,
    pub was_previous_version_older: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuxWindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

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

fn aux_window_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(AUX_WINDOW_STATE_FILE))
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

fn read_settings_value(app: &AppHandle) -> Result<serde_json::Value, String> {
    match read_settings(app.clone())? {
        Some(contents) => serde_json::from_str(&contents).map_err(|e| e.to_string()),
        None => Ok(serde_json::json!({})),
    }
}

fn write_settings_value(app: &AppHandle, value: &serde_json::Value) -> Result<(), String> {
    let path = settings_path(app)?;
    let contents = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

fn parse_version(value: &str) -> Option<Version> {
    Version::parse(value).ok().or_else(|| {
        let trimmed = value.trim();
        trimmed
            .strip_prefix('v')
            .and_then(|rest| Version::parse(rest).ok())
    })
}

#[tauri::command]
pub fn was_previous_version_old(app: AppHandle) -> Result<PreviousVersionStatus, String> {
    let mut settings = read_settings_value(&app)?;
    let root = settings
        .as_object_mut()
        .ok_or_else(|| "settings root must be a JSON object".to_string())?;

    let app_state = root
        .entry(APP_STATE_KEY.to_string())
        .or_insert_with(|| serde_json::json!({}));
    let app_state_obj = app_state
        .as_object_mut()
        .ok_or_else(|| "settings.appState must be a JSON object".to_string())?;

    let current_version = app.package_info().version.to_string();
    let previous_version = app_state_obj
        .get(LAST_SEEN_APP_VERSION_KEY)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let was_previous_version_older = match previous_version.as_deref() {
        Some(previous) => match (parse_version(previous), parse_version(&current_version)) {
            (Some(prev), Some(curr)) => prev < curr,
            _ => previous != current_version,
        },
        None => false,
    };

    app_state_obj.insert(
        LAST_SEEN_APP_VERSION_KEY.to_string(),
        serde_json::Value::String(current_version),
    );
    write_settings_value(&app, &settings)?;

    Ok(PreviousVersionStatus {
        previous_version,
        was_previous_version_older,
    })
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

#[tauri::command]
pub fn read_aux_window_state(app: AppHandle, label: String) -> Result<Option<AuxWindowState>, String> {
    let path = aux_window_state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let states: HashMap<String, AuxWindowState> =
        serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(states.get(&label).cloned())
}

#[tauri::command]
pub fn write_aux_window_state(
    app: AppHandle,
    label: String,
    state: AuxWindowState,
) -> Result<(), String> {
    let path = aux_window_state_path(&app)?;
    let mut states: HashMap<String, AuxWindowState> = if path.exists() {
        let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&contents).unwrap_or_default()
    } else {
        HashMap::new()
    };
    states.insert(label, state);
    let contents = serde_json::to_string_pretty(&states).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())
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
