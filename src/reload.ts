import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

let unlistenFn: UnlistenFn | null = null;
let currentLabel: string | null = null;

export async function startWatching(filePath: string, onChange: () => void) {
  const win = getCurrentWebviewWindow();
  currentLabel = win.label;

  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }

  unlistenFn = await listen("file-changed", () => {
    const scrollPercent = computeScrollPercent();
    onChange();
    // After re-render the caller is responsible for restoring scroll.
    // We expose scrollPercent via window object so main can read it post-render.
    (window as unknown as { __pendingScrollPercent?: number }).__pendingScrollPercent =
      scrollPercent;
  });

  try {
    await invoke("start_watching", {
      windowLabel: currentLabel,
      path: filePath,
    });
  } catch (err) {
    console.warn("watcher: start failed", err);
  }
}

export async function stopWatching() {
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }
  if (currentLabel) {
    try {
      await invoke("stop_watching", { windowLabel: currentLabel });
    } catch {
      /* ignore */
    }
  }
}

function computeScrollPercent(): number {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  if (max <= 0) return 0;
  return doc.scrollTop / max;
}

export function restoreScrollPercent() {
  const pending = (window as unknown as { __pendingScrollPercent?: number }).__pendingScrollPercent;
  if (typeof pending === "number") {
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      doc.scrollTop = max * pending;
      (window as unknown as { __pendingScrollPercent?: number }).__pendingScrollPercent = undefined;
    });
  }
}
