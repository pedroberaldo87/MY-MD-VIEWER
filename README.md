# MD Viewer

A fast, native Markdown viewer for macOS. Built with Tauri 2 (Rust + WKWebView), TypeScript, and a vanilla frontend.

[Português (Brasil)](README.pt-BR.md)

> Status: pre-1.0 (`0.1.x`). Builds are **unsigned** and for **Apple Silicon** Macs only (details below).

## Features

- **GFM rendering** — tables, task lists, strikethrough, autolinks
- **Syntax highlighting** via highlight.js (GitHub Dark theme)
- **KaTeX math** — `$inline$` and `$$display$$`
- **Mermaid diagrams** — code blocks tagged with ` ```mermaid ` render lazily
- **Frontmatter YAML** — rendered as a metadata block at the top, with chips for `tags`/`aliases`
- **Relative image paths** — resolved against the file's directory
- **Theme** — light, dark, or follow system
- **Cmd+F** — in-file find with match counter, n/N navigation, Esc to close
- **Cmd+O** — open a file in a new window
- **Cmd+P** — recent files palette with fuzzy match
- **Cmd+\\** — toggle floating Table of Contents
- **Cmd+,** — settings (vault folder, theme)
- **Cmd+S** — Add current file to your Obsidian vault
- **Cmd+Shift+P** — Print / Export to PDF
- **Cmd+Shift+R** — Reveal in Finder
- **Auto-reload** — watches the open file; updates instantly when it changes externally
- **Window per file** — each Markdown file opens in its own window (TextEdit/Preview style)
- **File association** — register as default `.md` handler in Finder

## Install

1. Download `MD Viewer_<version>_aarch64.dmg` from the [Releases](../../releases) page.
2. Open the DMG and drag **MD Viewer** to `/Applications`.
3. **First launch (unsigned app).** The app is not signed with an Apple Developer ID and not notarized, so macOS Gatekeeper blocks it the first time. Pick one:
   - **System Settings → Privacy & Security** → scroll to the message about "MD Viewer" → **Open Anyway** (the route that works on macOS 15 and later).
   - **Right-click** the app → **Open** → **Open** (macOS 14 and earlier; macOS 15+ no longer offers this in the dialog).
   - Or remove the quarantine flag once from Terminal:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/MD Viewer.app"
     ```
4. Associate `.md` files with MD Viewer:
   - Find any `.md` in Finder → **Get Info** (`Cmd+I`).
   - Under **Open with**, pick **MD Viewer**.
   - Click **Change All…** → confirm.

**Requirements:** macOS 11 or later. The published DMG is built for **Apple Silicon (arm64)** only. On an Intel Mac, build from source (below).

## Security and privacy

- Raw HTML in Markdown is **not** rendered (it is shown as text). Frontmatter is escaped. Mermaid runs in `strict` mode.
- A Content-Security-Policy is set. **Remote images (`http(s)://…`) are blocked**, so opening an untrusted file cannot ping a tracking server. Images that do load: files next to the document (relative paths), `data:` and `blob:` URLs.
- Local images are served through Tauri's asset protocol, limited to the folder of the file you opened and its subfolders. A file sitting directly in your home folder only exposes its direct siblings, not the whole home tree.
- Links in a document never navigate the app window: `http(s)` and `mailto:` open in your default browser or mail client, relative `.md` links open in a new MD Viewer window, `#anchors` scroll, and everything else (`javascript:`, `file:`, `data:`, …) is ignored.
- No telemetry, and the app makes no network requests of its own.

## Add to Vault (Obsidian integration)

- Click the **Add to Vault** button (or `Cmd+S`).
- The first time, you're asked to select your Obsidian vault folder. The choice is persisted.
- The current file is **copied** into the vault folder.
  - Conflict on filename → choose **Replace** or **Keep both** (renamed with timestamp).
- A toast confirms with a **Reveal in Finder** action.

You can change the vault folder later via **Settings** (`Cmd+,`).

## Build from source

Requirements: macOS, [Rust](https://rustup.rs) (stable), Node.js 22+, [pnpm](https://pnpm.io) 11, Xcode Command Line Tools.

```bash
git clone https://github.com/pedroberaldo87/MY-MD-VIEWER.git
cd MY-MD-VIEWER
pnpm install --frozen-lockfile
pnpm tauri build --bundles dmg   # -> src-tauri/target/release/bundle/dmg/
```

The result matches your Mac's architecture (arm64 on Apple Silicon, x86_64 on Intel). The `.app` is in `src-tauri/target/release/bundle/macos/`.

## Development

```bash
# install JS deps
pnpm install

# dev mode with hot reload
pnpm tauri dev

# typecheck and unit tests
pnpm typecheck
pnpm test

# production build (.app + .dmg)
pnpm tauri build

# regenerate icons from src-tauri/icons/source.png
pnpm tauri icon src-tauri/icons/source.png
```

### Stack

- **Tauri 2** — Rust backend + WKWebView frontend, ~10MB binary
- **Vite + TypeScript** — vanilla frontend, no framework
- **markdown-it** + plugins: front-matter, anchor, task-lists, KaTeX
- **highlight.js** — syntax highlighting
- **mermaid** — diagrams (rendered lazy when present)
- **fuse.js** — fuzzy match for the recent-files palette

### Project layout

```
src/                  # TypeScript frontend
  main.ts             # bootstrap, parse ?file= URL param
  markdown.ts         # markdown-it singleton
  frontmatter.ts      # YAML subset parser + rendering
  mermaid.ts          # lazy diagram render
  toc.ts              # floating TOC
  search.ts           # Cmd+F overlay
  recent.ts           # recent files store
  palette.ts          # Cmd+P palette UI
  vault.ts            # Add to Vault flow
  settings.ts         # Cmd+, dialog
  theme.ts            # light/dark/system
  reload.ts           # file-watcher event integration
  menu.ts             # global keyboard shortcuts
  toast.ts            # notification stack
  styles/             # CSS — tokens, prose, ui, print

src-tauri/            # Rust backend
  src/lib.rs          # app entry — RunEvent::Opened handling
  src/window.rs       # window-per-file logic
  src/fs_ops.rs       # read file, copy_to_vault, reveal_in_finder
  src/watcher.rs      # per-window file watcher
  tauri.conf.json     # bundle, fileAssociations, identifier
  capabilities/       # permission scopes
  icons/              # generated from icons/source.png
```

## Releases (maintainers)

CI builds on every push and PR to `main` (`.github/workflows/build.yml`). Pushing a tag `vX.Y.Z` that matches the version in `src-tauri/tauri.conf.json` runs `.github/workflows/release.yml`, which builds the unsigned DMG and attaches it to a **draft** GitHub Release. Review and publish it by hand.

## License

[MIT](LICENSE)
