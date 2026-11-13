//! Backend-side registry of the paths the *user* chose, and the checks every
//! path-taking command runs against it.
//!
//! Threat model: the renderer can be compromised (e.g. a future XSS in rendered
//! Markdown) and then calls our Tauri commands with attacker-chosen paths. A path
//! therefore only counts as "chosen by the user" if the Rust side saw the choice:
//! the native open dialog (run from Rust), a file handed to the app by Finder /
//! argv, or a file the user approved in an earlier session (persisted by Rust).
//!
//! What a command may touch afterwards:
//! * a registered file itself (any extension, it was user-chosen), or
//! * a Markdown file (`.md`, `.markdown`, ...) inside the directory of a
//!   registered file. This is the same rule as the asset-protocol scope in
//!   `window.rs` (recursive, except `/` and `$HOME`, where only direct children
//!   count), so relative `.md` links keep working.
//! Paths are canonicalized first, so `..` and symlinks that leave the directory
//! resolve to their real location and are judged there.

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Largest Markdown file we read or copy.
pub const MAX_MARKDOWN_BYTES: u64 = 16 * 1024 * 1024;
/// How many user-chosen files are remembered (oldest dropped first).
const MAX_REGISTERED: usize = 500;
const STORE_FILE: &str = "approved-paths.json";

const MARKDOWN_EXTS: [&str; 6] = ["md", "markdown", "mdown", "mkd", "mdwn", "mkdn"];

/// Same extension list as the link policy in `src/links.ts`.
pub fn is_markdown_name(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTS.iter().any(|m| e.eq_ignore_ascii_case(m)))
        .unwrap_or(false)
}

/// A directory whose whole tree must not be exposed because a file sits in it:
/// `/` and the home folder. There only direct children are in scope.
pub fn dir_is_too_broad(dir: &Path, home: Option<&Path>) -> bool {
    dir.parent().is_none() || home == Some(dir)
}

/// Canonicalize and require an existing regular file (symlinks are resolved).
pub fn canonical_regular_file(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    let canon = std::fs::canonicalize(path).map_err(|_| "File not found".to_string())?;
    let meta = std::fs::metadata(&canon).map_err(|_| "File not found".to_string())?;
    if !meta.is_file() {
        return Err("Not a regular file".to_string());
    }
    Ok(canon)
}

/// Read a file as UTF-8 text, refusing anything over `max` bytes. The size is
/// enforced on the bytes actually read, not only on the metadata (the file can
/// grow between the two). Returns (content, mtime in ms).
pub fn read_capped(path: &Path, max: u64) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a regular file".to_string());
    }
    if meta.len() > max {
        return Err(format!(
            "File is too large (limit {} MiB)",
            max / (1024 * 1024)
        ));
    }
    let mut content = String::new();
    (&mut file)
        .take(max + 1)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() as u64 > max {
        return Err(format!(
            "File is too large (limit {} MiB)",
            max / (1024 * 1024)
        ));
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok((content, mtime))
}

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct Registry {
    /// Canonical paths of files the user chose, most recent first.
    files: Vec<PathBuf>,
    /// Canonical path of the vault folder the user chose.
    vault: Option<PathBuf>,
}

impl Registry {
    pub fn register_file(&mut self, canon: PathBuf) {
        self.files.retain(|p| p != &canon);
        self.files.insert(0, canon);
        self.files.truncate(MAX_REGISTERED);
    }

    pub fn set_vault(&mut self, canon_dir: PathBuf) {
        self.vault = Some(canon_dir);
    }

    pub fn vault(&self) -> Option<&Path> {
        self.vault.as_deref()
    }

    /// Is this *canonical* path in scope (registered, or Markdown inside the
    /// directory of a registered file)?
    pub fn allows(&self, canon: &Path, home: Option<&Path>) -> bool {
        if self.files.iter().any(|p| p == canon) {
            return true;
        }
        if !is_markdown_name(canon) {
            return false;
        }
        self.files.iter().any(|reg| {
            let Some(dir) = reg.parent() else {
                return false;
            };
            if dir_is_too_broad(dir, home) {
                canon.parent() == Some(dir)
            } else {
                canon.starts_with(dir)
            }
        })
    }

    /// Check for reading/copying: existing regular file that is in scope.
    pub fn authorize_read(&self, path: &str, home: Option<&Path>) -> Result<PathBuf, String> {
        let canon = canonical_regular_file(Path::new(path))?;
        if self.allows(&canon, home) {
            Ok(canon)
        } else {
            Err("Not allowed: this file was not opened by the user".to_string())
        }
    }

    /// Check for "reveal in Finder": like `authorize_read`, plus anything inside
    /// the vault folder (the copy we just made there).
    pub fn authorize_reveal(&self, path: &str, home: Option<&Path>) -> Result<PathBuf, String> {
        let p = Path::new(path);
        if !p.is_absolute() {
            return Err("Path must be absolute".to_string());
        }
        let canon = std::fs::canonicalize(p).map_err(|_| "File not found".to_string())?;
        let in_vault = self.vault.as_deref().is_some_and(|v| canon.starts_with(v));
        if in_vault || self.allows(&canon, home) {
            Ok(canon)
        } else {
            Err("Not allowed: this path was not opened by the user".to_string())
        }
    }
}

/// Where a copy of `src` goes inside `vault_dir`, honoring the conflict policy.
/// `vault_dir` must be canonical. Never follows a symlink at the destination.
pub fn vault_destination(
    vault_dir: &Path,
    src: &Path,
    on_conflict: &str,
    now_secs: u64,
) -> Result<PathBuf, String> {
    let file_name = src
        .file_name()
        .ok_or_else(|| "Source file has no name".to_string())?;
    let mut dest = vault_dir.join(file_name);
    if dest.parent() != Some(vault_dir) {
        return Err("Invalid destination".to_string());
    }
    match std::fs::symlink_metadata(&dest) {
        Err(_) => return Ok(dest),
        Ok(meta) => {
            if meta.file_type().is_symlink() || !meta.is_file() {
                return Err("Destination exists and is not a regular file".to_string());
            }
        }
    }
    match on_conflict {
        "replace" => Ok(dest),
        "rename" => {
            let stem = src
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());
            let ext = src
                .extension()
                .map(|s| format!(".{}", s.to_string_lossy()))
                .unwrap_or_default();
            dest = vault_dir.join(format!("{}-{}{}", stem, now_secs, ext));
            if std::fs::symlink_metadata(&dest).is_ok() {
                return Err("Destination already exists".to_string());
            }
            Ok(dest)
        }
        _ => Err("cancelled".to_string()),
    }
}

/// Shared, persisted registry (managed Tauri state).
#[derive(Default)]
pub struct Approved {
    reg: Mutex<Registry>,
    store: Mutex<Option<PathBuf>>,
}

fn home_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    std::fs::canonicalize(&home).ok().or(Some(home))
}

impl Approved {
    /// Load the registry kept by Rust in `data_dir`. On first run after the
    /// upgrade there is no such file yet: import the vault folder and recent
    /// files the user already had in the settings store (they chose them in
    /// earlier sessions), then write our own file.
    pub fn load(&self, data_dir: &Path) {
        let path = data_dir.join(STORE_FILE);
        *self.store.lock().unwrap() = Some(path.clone());
        let loaded: Option<Registry> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok());
        let (reg, migrated) = match loaded {
            Some(r) => (r, false),
            None => (migrate_legacy(&data_dir.join("settings.json")), true),
        };
        *self.reg.lock().unwrap() = reg;
        if migrated {
            self.persist();
        }
    }

    fn persist(&self) {
        let Some(path) = self.store.lock().unwrap().clone() else {
            return;
        };
        let snapshot = self.reg.lock().unwrap().clone();
        let Ok(json) = serde_json::to_string_pretty(&snapshot) else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, json)
            .and_then(|_| std::fs::rename(&tmp, &path))
            .is_err()
        {
            log::warn!("could not persist {}", path.display());
        }
    }

    /// The user picked/opened this file (dialog, Finder, argv). Registers the
    /// canonical path.
    pub fn register_user_file(&self, path: &Path) -> Result<PathBuf, String> {
        let canon = canonical_regular_file(path)?;
        self.reg.lock().unwrap().register_file(canon.clone());
        self.persist();
        Ok(canon)
    }

    /// The user picked this folder as the vault.
    pub fn register_user_vault(&self, path: &Path) -> Result<PathBuf, String> {
        if !path.is_absolute() {
            return Err("Path must be absolute".to_string());
        }
        let canon = std::fs::canonicalize(path).map_err(|_| "Folder not found".to_string())?;
        if !canon.is_dir() {
            return Err("Vault path is not a directory".to_string());
        }
        self.reg.lock().unwrap().set_vault(canon.clone());
        self.persist();
        Ok(canon)
    }

    pub fn vault(&self) -> Option<PathBuf> {
        self.reg.lock().unwrap().vault().map(Path::to_path_buf)
    }

    pub fn authorize_read(&self, path: &str) -> Result<PathBuf, String> {
        self.reg
            .lock()
            .unwrap()
            .authorize_read(path, home_dir().as_deref())
    }

    pub fn authorize_reveal(&self, path: &str) -> Result<PathBuf, String> {
        self.reg
            .lock()
            .unwrap()
            .authorize_reveal(path, home_dir().as_deref())
    }

    /// Existence probe that does not leak anything about out-of-scope paths.
    pub fn exists_in_scope(&self, path: &str) -> bool {
        self.authorize_reveal(path).is_ok()
    }
}

/// One-time import from the old settings store (`recent_files`, `vault_folder`).
fn migrate_legacy(settings_json: &Path) -> Registry {
    let mut reg = Registry::default();
    let Some(json) = std::fs::read_to_string(settings_json)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
    else {
        return reg;
    };
    if let Some(list) = json.get("recent_files").and_then(|v| v.as_array()) {
        // Oldest first, so the most recent ends up first in the registry.
        for item in list.iter().rev() {
            if let Some(p) = item.get("path").and_then(|v| v.as_str()) {
                if let Ok(canon) = canonical_regular_file(Path::new(p)) {
                    reg.register_file(canon);
                }
            }
        }
    }
    if let Some(v) = json.get("vault_folder").and_then(|v| v.as_str()) {
        if let Ok(canon) = std::fs::canonicalize(v) {
            if canon.is_dir() {
                reg.set_vault(canon);
            }
        }
    }
    reg
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    struct Fixture {
        _tmp: tempfile::TempDir,
        root: PathBuf, // canonical
    }

    fn fixture() -> Fixture {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        Fixture { _tmp: tmp, root }
    }

    fn write(path: &Path, content: &str) -> PathBuf {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
        path.to_path_buf()
    }

    fn registry_with(file: &Path) -> Registry {
        let mut r = Registry::default();
        r.register_file(fs::canonicalize(file).unwrap());
        r
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn nothing_registered_denies_everything() {
        let f = fixture();
        let a = write(&f.root.join("a.md"), "hi");
        assert!(Registry::default().authorize_read(&s(&a), None).is_err());
    }

    #[test]
    fn registered_file_is_allowed_even_without_md_extension() {
        let f = fixture();
        let a = write(&f.root.join("notes.txt"), "hi");
        assert!(registry_with(&a).authorize_read(&s(&a), None).is_ok());
    }

    #[test]
    fn md_next_to_registered_file_is_allowed_including_subfolders() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let b = write(&f.root.join("docs/b.markdown"), "b");
        let c = write(&f.root.join("docs/sub/deep/c.md"), "c");
        let r = registry_with(&a);
        assert!(r.authorize_read(&s(&b), None).is_ok());
        assert!(r.authorize_read(&s(&c), None).is_ok());
    }

    #[test]
    fn non_markdown_neighbour_is_denied() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let secret = write(&f.root.join("docs/id_rsa"), "key");
        let txt = write(&f.root.join("docs/passwords.txt"), "pw");
        let r = registry_with(&a);
        assert!(r.authorize_read(&s(&secret), None).is_err());
        assert!(r.authorize_read(&s(&txt), None).is_err());
    }

    #[test]
    fn md_outside_the_directory_is_denied() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let other = write(&f.root.join("elsewhere/x.md"), "x");
        let r = registry_with(&a);
        assert!(r.authorize_read(&s(&other), None).is_err());
    }

    #[test]
    fn dotdot_that_escapes_is_denied_and_dotdot_that_stays_is_allowed() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        write(&f.root.join("docs/sub/ok.md"), "ok");
        write(&f.root.join("outside.md"), "o");
        let r = registry_with(&a);
        let escaping = format!("{}/docs/sub/../../outside.md", f.root.display());
        let staying = format!("{}/docs/sub/../sub/ok.md", f.root.display());
        assert!(r.authorize_read(&escaping, None).is_err());
        assert!(r.authorize_read(&staying, None).is_ok());
    }

    #[test]
    fn relative_paths_are_rejected() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let r = registry_with(&a);
        assert!(r.authorize_read("docs/a.md", None).is_err());
        assert!(r.authorize_read("a.md", None).is_err());
    }

    #[test]
    fn symlink_escaping_the_directory_is_denied() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let target = write(&f.root.join("private/secret.md"), "secret");
        symlink(&target, f.root.join("docs/innocent.md")).unwrap();
        // A symlink to a directory outside, then a .md inside it.
        symlink(f.root.join("private"), f.root.join("docs/linkdir")).unwrap();
        let r = registry_with(&a);
        assert!(r
            .authorize_read(&s(&f.root.join("docs/innocent.md")), None)
            .is_err());
        assert!(r
            .authorize_read(&s(&f.root.join("docs/linkdir/secret.md")), None)
            .is_err());
    }

    #[test]
    fn symlink_staying_inside_the_directory_is_allowed() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let real = write(&f.root.join("docs/real/x.md"), "x");
        symlink(&real, f.root.join("docs/alias.md")).unwrap();
        let r = registry_with(&a);
        let got = r
            .authorize_read(&s(&f.root.join("docs/alias.md")), None)
            .unwrap();
        assert_eq!(got, real);
    }

    #[test]
    fn directories_and_missing_files_are_denied() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        fs::create_dir_all(f.root.join("docs/folder.md")).unwrap();
        let r = registry_with(&a);
        assert!(r
            .authorize_read(&s(&f.root.join("docs/folder.md")), None)
            .is_err());
        assert!(r
            .authorize_read(&s(&f.root.join("docs/nope.md")), None)
            .is_err());
    }

    #[test]
    fn home_or_root_directory_exposes_direct_children_only() {
        let f = fixture();
        let home = f.root.join("home");
        let a = write(&home.join("a.md"), "a");
        let sibling = write(&home.join("b.md"), "b");
        let nested = write(&home.join("Documents/private.md"), "p");
        let r = registry_with(&a);
        assert!(r.authorize_read(&s(&sibling), Some(&home)).is_ok());
        assert!(r.authorize_read(&s(&nested), Some(&home)).is_err());
        // Without the home rule the same nested file would be in scope.
        assert!(r.authorize_read(&s(&nested), None).is_ok());
        assert!(dir_is_too_broad(Path::new("/"), None));
        assert!(dir_is_too_broad(&home, Some(&home)));
        assert!(!dir_is_too_broad(&home.join("Documents"), Some(&home)));
    }

    #[test]
    fn markdown_extension_check_matches_link_policy() {
        for ok in [
            "a.md",
            "a.MD",
            "a.markdown",
            "a.mdown",
            "a.mkd",
            "a.mdwn",
            "a.mkdn",
        ] {
            assert!(is_markdown_name(Path::new(ok)), "{ok}");
        }
        for bad in ["a.txt", "a", "md", ".md.bak", "a.mdx", "a.md.sh"] {
            assert!(!is_markdown_name(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn read_capped_refuses_too_large_and_accepts_exact_limit() {
        let f = fixture();
        let big = write(&f.root.join("big.md"), &"x".repeat(101));
        let exact = write(&f.root.join("exact.md"), &"x".repeat(100));
        assert!(read_capped(&big, 100).unwrap_err().contains("too large"));
        let (content, _mtime) = read_capped(&exact, 100).unwrap();
        assert_eq!(content.len(), 100);
    }

    #[test]
    fn read_capped_refuses_non_utf8() {
        let f = fixture();
        let p = f.root.join("bin.md");
        fs::write(&p, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_capped(&p, 100).is_err());
    }

    #[test]
    fn reveal_allows_registered_scope_and_vault_but_not_the_rest() {
        let f = fixture();
        let a = write(&f.root.join("docs/a.md"), "a");
        let vault = f.root.join("vault");
        let in_vault = write(&vault.join("note.txt"), "n");
        let stranger = write(&f.root.join("other/file.md"), "o");
        let mut r = registry_with(&a);
        r.set_vault(fs::canonicalize(&vault).unwrap());
        assert!(r.authorize_reveal(&s(&a), None).is_ok());
        assert!(r.authorize_reveal(&s(&in_vault), None).is_ok());
        assert!(r.authorize_reveal(&s(&stranger), None).is_err());
        assert!(r.authorize_reveal("/etc/passwd", None).is_err());
        assert!(r.authorize_reveal("../etc", None).is_err());
    }

    #[test]
    fn vault_destination_new_file_and_rename_and_replace() {
        let f = fixture();
        let vault = f.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let src = write(&f.root.join("docs/a.md"), "a");
        // New file.
        assert_eq!(
            vault_destination(&vault, &src, "rename", 7).unwrap(),
            vault.join("a.md")
        );
        // Conflict: rename / replace / anything else.
        write(&vault.join("a.md"), "old");
        assert_eq!(
            vault_destination(&vault, &src, "rename", 7).unwrap(),
            vault.join("a-7.md")
        );
        assert_eq!(
            vault_destination(&vault, &src, "replace", 7).unwrap(),
            vault.join("a.md")
        );
        assert_eq!(
            vault_destination(&vault, &src, "other", 7).unwrap_err(),
            "cancelled"
        );
    }

    #[test]
    fn vault_destination_never_writes_through_a_symlink() {
        let f = fixture();
        let vault = f.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let victim = write(&f.root.join("victim.md"), "victim");
        symlink(&victim, vault.join("a.md")).unwrap();
        let src = write(&f.root.join("docs/a.md"), "a");
        assert!(vault_destination(&vault, &src, "replace", 7).is_err());
        assert!(vault_destination(&vault, &src, "rename", 7).is_err());
    }

    #[test]
    fn approved_register_and_authorize_end_to_end_with_persistence() {
        let f = fixture();
        let data = f.root.join("data");
        let a = write(&f.root.join("docs/a.md"), "a");
        let b = write(&f.root.join("docs/b.md"), "b");
        let vault = f.root.join("vault");
        fs::create_dir_all(&vault).unwrap();

        let ap = Approved::default();
        ap.load(&data);
        assert!(ap.authorize_read(&s(&a)).is_err());
        ap.register_user_file(&a).unwrap();
        ap.register_user_vault(&vault).unwrap();
        assert!(ap.authorize_read(&s(&b)).is_ok());
        assert!(ap.register_user_file(&f.root.join("nope.md")).is_err());
        assert!(ap.register_user_file(&f.root.join("docs")).is_err());

        // A new process sees what the first one approved.
        let again = Approved::default();
        again.load(&data);
        assert!(again.authorize_read(&s(&b)).is_ok());
        assert_eq!(again.vault().unwrap(), fs::canonicalize(&vault).unwrap());
    }

    #[test]
    fn legacy_settings_are_imported_once_on_first_load() {
        let f = fixture();
        let data = f.root.join("data");
        let a = write(&f.root.join("docs/a.md"), "a");
        let b = write(&f.root.join("docs/b.md"), "b");
        let vault = f.root.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let ghost = f.root.join("gone/ghost.md");
        write(
            &data.join("settings.json"),
            &serde_json::json!({
                "recent_files": [
                    {"path": s(&a), "name": "a.md", "lastOpenedAt": 1},
                    {"path": s(&ghost), "name": "ghost.md", "lastOpenedAt": 2},
                ],
                "vault_folder": s(&vault),
            })
            .to_string(),
        );
        let ap = Approved::default();
        ap.load(&data);
        assert!(ap.authorize_read(&s(&b)).is_ok()); // neighbour of an imported recent
        assert!(ap.authorize_read(&s(&ghost)).is_err());
        assert_eq!(ap.vault().unwrap(), fs::canonicalize(&vault).unwrap());
        assert!(data.join(STORE_FILE).exists());

        // Once our own file exists, the settings store is no longer consulted.
        write(&data.join("settings.json"), "{\"recent_files\":[]}");
        fs::write(data.join(STORE_FILE), "{\"files\":[],\"vault\":null}").unwrap();
        let again = Approved::default();
        again.load(&data);
        assert!(again.authorize_read(&s(&b)).is_err());
    }

    #[test]
    fn registry_is_capped_and_deduplicated() {
        let mut r = Registry::default();
        for i in 0..(MAX_REGISTERED + 10) {
            r.register_file(PathBuf::from(format!("/x/{i}.md")));
        }
        r.register_file(PathBuf::from("/x/509.md"));
        assert_eq!(r.files.len(), MAX_REGISTERED);
        assert_eq!(r.files[0], PathBuf::from("/x/509.md"));
    }
}
