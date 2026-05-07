# MD Viewer

A fast, native Markdown viewer for macOS. Built with Tauri 2 (Rust + WKWebView), TypeScript, and a vanilla frontend.

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

## Install (first time)

1. Build the app: `pnpm install && pnpm tauri build`.
2. Drag `src-tauri/target/release/bundle/macos/MD Viewer.app` to `/Applications`.
3. **First open is special** — the app is unsigned, so Gatekeeper will warn.
   - Right-click `MD Viewer.app` → **Open** → confirm.
   - Or run once from Terminal:
     ```bash
     xattr -dr com.apple.quarantine "/Applications/MD Viewer.app"
     ```
4. Associate `.md` files with MD Viewer:
   - Find any `.md` in Finder → **Get Info** (`Cmd+I`).
   - Under **Open with**, pick **MD Viewer**.
   - Click **Change All…** → confirm.

## Add to Vault (Obsidian integration)

- Click the **Add to Vault** button (or `Cmd+S`).
- The first time, you're asked to select your Obsidian vault folder. The choice is persisted.
- The current file is **copied** into the vault folder.
  - Conflict on filename → choose **Replace** or **Keep both** (renamed with timestamp).
- A toast confirms with a **Reveal in Finder** action.

You can change the vault folder later via **Settings** (`Cmd+,`).

## Development

```bash
# install JS deps
pnpm install

# dev mode with hot reload
pnpm tauri dev

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

## Notes

- App is **unsigned** — for personal use. Distributing requires Apple Developer ID + notarization.
- Scoped to macOS for now. Other platforms are not tested.
