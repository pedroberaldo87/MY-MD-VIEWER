use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
pub struct MarkdownFile {
    pub content: String,
    pub dir: String,
    pub name: String,
    pub mtime: u64,
}

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<MarkdownFile, String> {
    let path_buf = PathBuf::from(&path);
    let content = std::fs::read_to_string(&path_buf).map_err(|e| e.to_string())?;
    let metadata = std::fs::metadata(&path_buf).map_err(|e| e.to_string())?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let dir = path_buf
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = path_buf
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

#[tauri::command]
pub fn copy_to_vault(
    src: String,
    vault: String,
    on_conflict: String,
) -> Result<String, String> {
    let src_path = Path::new(&src);
    let vault_path = Path::new(&vault);

    if !vault_path.exists() {
        return Err(format!("Vault folder does not exist: {}", vault));
    }
    if !vault_path.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault));
    }
    if !src_path.exists() {
        return Err(format!("Source file does not exist: {}", src));
    }

    let file_name = src_path
        .file_name()
        .ok_or_else(|| "Source file has no name".to_string())?;
    let mut dest_path = vault_path.join(file_name);

    if dest_path.exists() {
        match on_conflict.as_str() {
            "replace" => {
                // Overwrite — fall through to the copy below.
            }
            "rename" => {
                let stem = src_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "file".to_string());
                let ext = src_path
                    .extension()
                    .map(|s| format!(".{}", s.to_string_lossy()))
                    .unwrap_or_default();
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                dest_path = vault_path.join(format!("{}-{}{}", stem, ts, ext));
            }
            _ => return Err("cancelled".to_string()),
        }
    }

    std::fs::copy(src_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
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
