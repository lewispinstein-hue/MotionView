// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod export;
mod settings;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            settings::read_settings,
            settings::write_settings,
            settings::read_image_data,
            settings::save_robot_image,
            settings::read_saved_paths,
            settings::write_saved_paths,
            export::export_motionview_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
