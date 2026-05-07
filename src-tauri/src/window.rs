use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

/// True once SOMETHING (Apple Event, argv, or the cold-launch grace timer)
/// has produced a window. This prevents the welcome window from racing the
/// first file the user double-clicked in Finder.
pub static FIRST_WINDOW_HANDLED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn open_file_in_new_window(app: AppHandle, path: String) -> Result<String, String> {
    open_file_in_new_window_internal(&app, path)
}

#[tauri::command]
pub fn open_empty_window(app: AppHandle) -> Result<String, String> {
    open_empty_window_internal(&app)
}

pub fn open_file_in_new_window_internal(app: &AppHandle, path: String) -> Result<String, String> {
    let label = format!("file-{}", short_id());
    let encoded = utf8_percent_encode(&path, NON_ALPHANUMERIC).to_string();
    let url = format!("index.html?file={}", encoded);
    let title = file_title(&path);

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(980.0, 720.0)
        .min_inner_size(480.0, 360.0)
        .resizable(true)
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Transparent)
        .hidden_title(true)
        .build()
        .map(|_| label)
        .map_err(|e| e.to_string())
}

pub fn open_empty_window_internal(app: &AppHandle) -> Result<String, String> {
    let label = format!("empty-{}", short_id());
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("MD Viewer")
        .inner_size(980.0, 720.0)
        .min_inner_size(480.0, 360.0)
        .resizable(true)
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Transparent)
        .hidden_title(true)
        .build()
        .map(|_| label)
        .map_err(|e| e.to_string())
}

fn short_id() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_string()
}

fn file_title(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "MD Viewer".to_string())
}
