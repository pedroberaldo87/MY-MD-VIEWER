use crate::scope::{self, Approved};
use crate::window;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Serialize)]
pub struct MarkdownFile {
    pub content: String,
    pub dir: String,
    pub name: String,
    pub mtime: u64,
}

/// Read a Markdown file the user opened (or one next to it, e.g. a linked note).
/// See `scope.rs` for exactly what is accepted.
#[tauri::command]
pub fn read_markdown_file(
    path: String,
    approved: State<'_, Approved>,
) -> Result<MarkdownFile, String> {
    let canon = approved.authorize_read(&path)?;
    let (content, mtime) = scope::read_capped(&canon, scope::MAX_MARKDOWN_BYTES)?;
    let dir = canon
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = canon
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(MarkdownFile {
        content,
        dir,
        name,
        mtime,
    })
}

/// Copy the open file into the vault folder the user chose. The vault is the one
/// registered by `choose_vault_folder`, never a path supplied by the webview.
#[tauri::command]
pub fn copy_to_vault(
    src: String,
    on_conflict: String,
    approved: State<'_, Approved>,
) -> Result<String, String> {
    let vault = approved
        .vault()
        .ok_or_else(|| "Vault folder is not configured".to_string())?;
    if !vault.is_dir() {
        return Err(format!("Vault folder does not exist: {}", vault.display()));
    }
    let src_path = approved.authorize_read(&src)?;
    // Same size limit as reading, checked on the file we are about to copy.
    let len = std::fs::metadata(&src_path)
        .map_err(|e| e.to_string())?
        .len();
    if len > scope::MAX_MARKDOWN_BYTES {
        return Err("File is too large to copy".to_string());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest_path = scope::vault_destination(&vault, &src_path, &on_conflict, now)?;

    // Copying a file onto itself would truncate it (it is already in the vault).
    if std::fs::canonicalize(&dest_path).ok().as_deref() == Some(src_path.as_path()) {
        return Ok(dest_path.to_string_lossy().to_string());
    }
    std::fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_in_finder(path: String, approved: State<'_, Approved>) -> Result<(), String> {
    let canon = approved.authorize_reveal(&path)?;
    Command::new("open")
        .arg("-R")
        .arg(&canon)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Only answers for paths the user opened (or that live next to one / in the
/// vault); anything else is reported as missing so it cannot be probed.
#[tauri::command]
pub fn path_exists(path: String, approved: State<'_, Approved>) -> bool {
    approved.exists_in_scope(&path)
}

/// Native "Open…" dialog, run from Rust so the choice is registered by the
/// backend and cannot be forged by the webview. Opens the file in a new window.
#[tauri::command]
pub async fn pick_markdown_file(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter(
            "Markdown",
            &["md", "markdown", "mdown", "mkd", "mdwn", "mkdn"],
        )
        .blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    window::open_user_chosen_file(&app, &path).map(Some)
}

/// The vault folder currently configured (registered by Rust), if any.
#[tauri::command]
pub fn get_vault_folder(approved: State<'_, Approved>) -> Option<String> {
    approved.vault().map(|p| p.to_string_lossy().to_string())
}

/// Let the user choose the vault folder: offer the Obsidian-detected one first,
/// then fall back to a folder picker. Both run natively from Rust; the chosen
/// folder is what `copy_to_vault` will accept.
#[tauri::command]
pub async fn choose_vault_folder(
    window: WebviewWindow,
    app: AppHandle,
    approved: State<'_, Approved>,
) -> Result<Option<String>, String> {
    if let Some(detected) = detect_obsidian_vault() {
        let use_detected = app
            .dialog()
            .message(format!(
                "Found Obsidian vault:\n\n{}\n\nUse this as your vault folder?",
                detected.path
            ))
            .title("Vault detected")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Use this".to_string(),
                "Choose another…".to_string(),
            ))
            .blocking_show();
        if use_detected {
            let canon = approved.register_user_vault(Path::new(&detected.path))?;
            return Ok(Some(canon.to_string_lossy().to_string()));
        }
    }

    let picked = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Select your Obsidian vault folder")
        .blocking_pick_folder();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let canon = approved.register_user_vault(&path)?;
    Ok(Some(canon.to_string_lossy().to_string()))
}

#[derive(Serialize)]
pub struct DetectedVault {
    pub path: String,
    pub source: String,
}

#[tauri::command]
pub fn detect_obsidian_vault() -> Option<DetectedVault> {
    let home = std::env::var("HOME").ok()?;
    let cfg_path = PathBuf::from(home).join("Library/Application Support/obsidian/obsidian.json");
    if !cfg_path.exists() {
        return None;
    }
    let raw = std::fs::read_to_string(&cfg_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let vaults = json.get("vaults")?.as_object()?;

    // Prefer the vault flagged as open, else fall back to most recent by ts.
    let mut open_vault: Option<&serde_json::Value> = None;
    let mut newest: Option<(&serde_json::Value, u64)> = None;
    for (_id, v) in vaults {
        if v.get("open").and_then(|b| b.as_bool()).unwrap_or(false) && open_vault.is_none() {
            open_vault = Some(v);
        }
        let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);
        if newest.map(|(_, n)| ts > n).unwrap_or(true) {
            newest = Some((v, ts));
        }
    }

    let chosen = open_vault.or_else(|| newest.map(|(v, _)| v))?;
    let path = chosen.get("path")?.as_str()?.to_string();
    if !Path::new(&path).exists() {
        return None;
    }
    Some(DetectedVault {
        path,
        source: "obsidian".to_string(),
    })
}
