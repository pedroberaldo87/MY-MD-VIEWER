import { invoke } from "@tauri-apps/api/core";
import { openSearch, closeSearch } from "./search";
import { toggleToc } from "./toc";
import { openPalette } from "./palette";
import { openSettings } from "./settings";
import { addCurrentToVault } from "./vault";

interface MenuContext {
  getCurrentFilePath: () => string | null;
}

export function bindShortcuts(ctx: MenuContext) {
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;

    // Cmd+F — open search
    if (e.key === "f" && !e.shiftKey) {
      e.preventDefault();
      openSearch();
      return;
    }

    // Cmd+O — open file dialog
    if (e.key === "o" && !e.shiftKey) {
      e.preventDefault();
      openFileDialog();
      return;
    }

    // Cmd+P — recent files palette
    if (e.key === "p" && !e.shiftKey) {
      e.preventDefault();
      openPalette();
      return;
    }

    // Cmd+\\ — toggle TOC
    if (e.key === "\\") {
      e.preventDefault();
      toggleToc();
      return;
    }

    // Cmd+, — settings
    if (e.key === ",") {
      e.preventDefault();
      openSettings();
      return;
    }

    // Cmd+Shift+P — print
    if (e.key === "P" && e.shiftKey) {
      e.preventDefault();
      window.print();
      return;
    }

    // Cmd+Shift+R — reveal in Finder
    if (e.key === "R" && e.shiftKey) {
      e.preventDefault();
      const path = ctx.getCurrentFilePath();
      if (path) invoke("reveal_in_finder", { path }).catch(console.warn);
      return;
    }

    // Cmd+S — Add to Vault (mnemonic: Save to vault)
    if (e.key === "s" && !e.shiftKey) {
      e.preventDefault();
      addCurrentToVault(ctx.getCurrentFilePath());
      return;
    }

    // Cmd+W — close window
    if (e.key === "w") {
      // default macOS behavior already closes window; no-op
      return;
    }
  });

  // Esc closes search regardless of focus
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearch();
    }
  });

  // Toolbar buttons
  document.getElementById("btn-toc")?.addEventListener("click", () => toggleToc());
  document.getElementById("btn-vault")?.addEventListener("click", () => {
    addCurrentToVault(ctx.getCurrentFilePath());
  });
  document.getElementById("btn-menu")?.addEventListener("click", () => openSettings());
  document.getElementById("btn-theme")?.addEventListener("click", () => {
    import("./theme").then(({ getThemePref, setThemePref }) => {
      const cur = getThemePref();
      const next = cur === "light" ? "dark" : cur === "dark" ? "system" : "light";
      setThemePref(next);
    });
  });
}

async function openFileDialog() {
  // The native dialog runs in Rust, which registers the choice and opens the window.
  try {
    await invoke("pick_markdown_file");
  } catch (err) {
    console.warn("open dialog failed", err);
  }
}
