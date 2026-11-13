import { invoke } from "@tauri-apps/api/core";
import { renderMarkdown } from "./markdown";
import { renderFrontmatterBlock } from "./frontmatter";
import { renderMermaidIn } from "./mermaid";
import { rebuildToc } from "./toc";
import { initSearch } from "./search";
import { initRecents, pushRecent } from "./recent";
import { initPalette } from "./palette";
import { initVault } from "./vault";
import { initSettings } from "./settings";
import { initTheme, isDark, onThemeChange } from "./theme";
import { startWatching, stopWatching, restoreScrollPercent } from "./reload";
import { bindShortcuts } from "./menu";
import { initLinkHandler } from "./link-handler";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import "./styles/tokens.css";
import "./styles/prose.css";
import "./styles/ui.css";
import "./styles/print.css";
import type { MarkdownFile } from "./types";

window.__MD_VIEWER__ = {
  currentFilePath: null,
  currentFileDir: null,
};

async function boot() {
  await initTheme();
  await initVault();
  await initRecents();
  initSearch();
  initPalette();
  initSettings();
  initLinkHandler(() => window.__MD_VIEWER__.currentFileDir);
  bindShortcuts({
    getCurrentFilePath: () => window.__MD_VIEWER__.currentFilePath,
  });

  // Re-render mermaid when theme changes (it has its own theme system)
  onThemeChange(async () => {
    const content = document.getElementById("content");
    if (content) await renderMermaidIn(content, isDark());
  });

  // Pull file path from URL
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get("file");

  if (filePath) {
    await loadFile(filePath);
  } else {
    showEmptyState();
  }
}

async function loadFile(filePath: string) {
  try {
    const file = await invoke<MarkdownFile>("read_markdown_file", { path: filePath });
    window.__MD_VIEWER__.currentFilePath = filePath;
    window.__MD_VIEWER__.currentFileDir = file.dir;
    document.title = file.name || "MD Viewer";
    updateToolbar(filePath, file.name);
    renderInto(file);
    await pushRecent(filePath, file.name);

    await startWatching(filePath, async () => {
      try {
        const updated = await invoke<MarkdownFile>("read_markdown_file", { path: filePath });
        renderInto(updated);
        restoreScrollPercent();
      } catch (err) {
        console.warn("reload: failed to read file", err);
      }
    });

    window.addEventListener("beforeunload", () => {
      stopWatching();
    });
  } catch (err) {
    showError(`Failed to open file:\n${err}`);
  }
}

function renderInto(file: MarkdownFile) {
  const content = document.getElementById("content");
  if (!content) return;
  const empty = document.getElementById("empty-state");
  if (empty) empty.remove();

  const { html, frontmatter } = renderMarkdown(file.content, file.dir || null);
  const fmHtml = renderFrontmatterBlock(frontmatter);
  content.innerHTML = fmHtml + html;

  // Lazy mermaid
  void renderMermaidIn(content, isDark());

  // Build TOC
  const tocList = document.getElementById("toc-list");
  const tocAside = document.getElementById("toc");
  if (tocList && tocAside) rebuildToc(content, tocList, tocAside);
}

function updateToolbar(path: string, name: string) {
  const el = document.getElementById("file-path");
  if (!el) return;
  const collapsed = collapseHome(path);
  el.textContent = name;
  el.title = collapsed;
}

function collapseHome(path: string): string {
  const home = "/Users/";
  if (path.startsWith(home)) {
    const rest = path.substring(home.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) return "~" + rest.substring(slash);
  }
  return path;
}

function showEmptyState() {
  const fp = document.getElementById("file-path");
  if (fp) fp.textContent = "No file open";
}

function showError(msg: string) {
  const content = document.getElementById("content");
  if (!content) return;
  content.innerHTML = `<div class="error-state"><h2>Error</h2><pre>${escapeHtml(msg)}</pre></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", () => {
  void boot();
});
