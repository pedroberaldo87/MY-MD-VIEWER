use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState(pub Mutex<HashMap<String, Debouncer<RecommendedWatcher>>>);

impl Default for WatcherState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[tauri::command]
pub fn start_watching(
    window_label: String,
    path: String,
    app: AppHandle,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "watcher state lock poisoned".to_string())?;

    // Drop any previous watcher for this window so we don't leak descriptors.
    map.remove(&window_label);

    let label_for_callback = window_label.clone();
    let app_for_callback = app.clone();
    let path_for_callback = path.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(150),
        move |res: DebounceEventResult| {
            if let Ok(_events) = res {
                let _ = app_for_callback.emit_to(
                    label_for_callback.as_str(),
                    "file-changed",
                    path_for_callback.clone(),
                );
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(Path::new(&path), notify::RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    map.insert(window_label, debouncer);
    Ok(())
}

#[tauri::command]
pub fn stop_watching(window_label: String, state: State<'_, WatcherState>) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "watcher state lock poisoned".to_string())?;
    map.remove(&window_label);
    Ok(())
}
