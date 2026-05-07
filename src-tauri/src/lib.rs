mod fs_ops;
mod watcher;
mod window;

use std::sync::atomic::Ordering;
use std::time::Duration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(watcher::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            fs_ops::read_markdown_file,
            fs_ops::copy_to_vault,
            fs_ops::reveal_in_finder,
            fs_ops::path_exists,
            fs_ops::detect_obsidian_vault,
            window::open_file_in_new_window,
            window::open_empty_window,
            watcher::start_watching,
            watcher::stop_watching,
        ])
        .setup(|app| {
            // Open files passed via CLI argv. macOS file association does NOT use argv —
            // it sends Apple Events that are routed via RunEvent::Opened below — but argv
            // is still useful for Linux/Windows and `open --args` invocations.
            for arg in std::env::args().skip(1) {
                if arg.starts_with('-') {
                    continue;
                }
                if std::path::Path::new(&arg).exists() {
                    window::FIRST_WINDOW_HANDLED.store(true, Ordering::Relaxed);
                    let _ = window::open_file_in_new_window_internal(app.handle(), arg);
                }
            }

            // Cold-launch grace period: macOS dispatches the "open document" Apple Event
            // shortly after process start. If nothing claims the launch within 200ms, fall
            // back to the empty/welcome window.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                if !window::FIRST_WINDOW_HANDLED.load(Ordering::Relaxed) {
                    window::FIRST_WINDOW_HANDLED.store(true, Ordering::Relaxed);
                    let _ = window::open_empty_window_internal(&handle);
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[allow(clippy::single_match)]
        match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    let path_str = match url.to_file_path() {
                        Ok(p) => p.to_string_lossy().to_string(),
                        Err(_) => url.as_str().to_string(),
                    };
                    if std::path::Path::new(&path_str).exists() {
                        window::FIRST_WINDOW_HANDLED.store(true, Ordering::Relaxed);
                        let _ = window::open_file_in_new_window_internal(app_handle, path_str);
                    }
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    let _ = window::open_empty_window_internal(app_handle);
                }
            }
            _ => {}
        }
    });
}
