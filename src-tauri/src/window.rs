use crate::scope::{self, Approved};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

/// True once SOMETHING (Apple Event, argv, or the cold-launch grace timer)
/// has produced a window. This prevents the welcome window from racing the
/// first file the user double-clicked in Finder.
pub static FIRST_WINDOW_HANDLED: AtomicBool = AtomicBool::new(false);

/// Open a file in a new window. Callable from the webview (links, recents), so
/// the path must already be in the user-approved scope (see `scope.rs`).
#[tauri::command]
pub fn open_file_in_new_window(
    app: AppHandle,
    path: String,
    approved: State<'_, Approved>,
) -> Result<String, String> {
    let canon = approved.authorize_read(&path)?;
    open_file_in_new_window_internal(&app, &canon)
}

/// A file the user chose outside the webview (open dialog, Finder / Open With,
/// argv): register it, then open it.
pub fn open_user_chosen_file(app: &AppHandle, path: &Path) -> Result<String, String> {
    let canon = app.state::<Approved>().register_user_file(path)?;
    open_file_in_new_window_internal(app, &canon)
}

#[tauri::command]
pub fn open_empty_window(app: AppHandle) -> Result<String, String> {
    open_empty_window_internal(&app)
}

/// `path` must be canonical and already approved (callers above ensure it).
fn open_file_in_new_window_internal(app: &AppHandle, path: &Path) -> Result<String, String> {
    let label = format!("file-{}", short_id());
    let path_str = path.to_string_lossy().to_string();
    let encoded = utf8_percent_encode(&path_str, NON_ALPHANUMERIC).to_string();
    let url = format!("index.html?file={}", encoded);
    let title = file_title(&path_str);

    // Let the asset protocol serve images next to this file (and only those).
    allow_asset_dir_for(app, path);

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .on_navigation(is_app_url)
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
        .on_navigation(is_app_url)
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

/// Allow the asset protocol (used for relative images) to read the directory of
/// the file being opened. The static scope in tauri.conf.json is empty, so this
/// is the only way files become reachable through `asset:`.
///
/// The directory is allowed recursively so `images/foo.png` works, except when it
/// is `/` or the user's home folder itself (a Markdown file lying directly in
/// ~ must not expose the whole home tree): there only direct children are allowed.
fn allow_asset_dir_for(app: &AppHandle, file_path: &Path) {
    let Some(dir) = file_path.parent() else {
        return;
    };
    if dir.as_os_str().is_empty() || !dir.is_dir() {
        return;
    }
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|h| std::fs::canonicalize(&h).unwrap_or(h));
    let too_broad = scope::dir_is_too_broad(dir, home.as_deref());
    if let Err(e) = app.asset_protocol_scope().allow_directory(dir, !too_broad) {
        log::warn!("could not extend asset scope for {}: {}", dir.display(), e);
    }
}

/// Navigation guard: the webview may only ever show the app's own pages.
/// External links are opened in the default browser by the frontend.
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            // Vite dev server, debug builds only.
            Some("localhost") => cfg!(debug_assertions) && url.port() == Some(1420),
            _ => false,
        },
        _ => false,
    }
}
