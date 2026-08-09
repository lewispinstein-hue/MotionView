use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
}

fn sanitize_filename_base(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        let valid = ch.is_ascii_alphanumeric() || ch == ' ' || ch == '-' || ch == '_';
        if valid {
            out.push(ch);
        }
    }

    let trimmed = out.trim().trim_end_matches('.');
    trimmed.to_string()
}

fn resolve_export_dir(
    app: &AppHandle,
    location: &str,
    custom_path: Option<&str>,
) -> Result<PathBuf, String> {
    let path_api = app.path();
    let location_normalized = location.trim().to_lowercase();

    let dir = match location_normalized.as_str() {
        "downloads" => path_api
            .download_dir()
            .map_err(|e| format!("failed to resolve Downloads folder: {e}"))?,
        "documents" => path_api
            .document_dir()
            .map_err(|e| format!("failed to resolve Documents folder: {e}"))?,
        "desktop" => path_api
            .desktop_dir()
            .map_err(|e| format!("failed to resolve Desktop folder: {e}"))?,
        "custom" => {
            let raw = custom_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "custom export path is required".to_string())?;
            PathBuf::from(raw)
        }
        "project" => {
            let raw = custom_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "project export path is required".to_string())?;
            let dir = PathBuf::from(raw);
            std::fs::create_dir_all(&dir).map_err(|e| {
                format!(
                    "failed to create project export folder {}: {e}",
                    dir.display()
                )
            })?;
            dir
        }
        other => {
            return Err(format!("unsupported export location: {other}"));
        }
    };

    if !dir.exists() {
        return Err(format!("export folder does not exist: {}", dir.display()));
    }
    if !dir.is_dir() {
        return Err(format!("export path is not a folder: {}", dir.display()));
    }

    Ok(dir)
}

fn build_export_path(dir: &Path, filename_base: &str) -> Result<PathBuf, String> {
    let sanitized = sanitize_filename_base(filename_base);
    if sanitized.is_empty() {
        return Err("filename is empty after sanitization".to_string());
    }
    Ok(dir.join(format!("{sanitized}.json")))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn export_motionview_json(
    app: AppHandle,
    filename_base: String,
    location: String,
    custom_path: Option<String>,
    json_contents: String,
) -> Result<ExportResult, String> {
    serde_json::from_str::<serde_json::Value>(&json_contents)
        .map_err(|e| format!("invalid export JSON payload: {e}"))?;

    let dir = resolve_export_dir(&app, &location, custom_path.as_deref())?;
    let export_path = build_export_path(&dir, &filename_base)?;

    std::fs::write(&export_path, json_contents)
        .map_err(|e| format!("failed to write export file {}: {e}", export_path.display()))?;

    Ok(ExportResult {
        path: export_path.to_string_lossy().to_string(),
    })
}
