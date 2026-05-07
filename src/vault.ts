import { load, type Store } from "@tauri-apps/plugin-store";
import { open as openDialog, ask, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./toast";

const STORE_FILE = "settings.json";
const KEY = "vault_folder";

let storeRef: Store | null = null;
let cached: string | null = null;

interface DetectedVault {
  path: string;
  source: string;
}

export async function detectObsidianVault(): Promise<DetectedVault | null> {
  try {
    return (await invoke<DetectedVault | null>("detect_obsidian_vault")) ?? null;
  } catch {
    return null;
  }
}

async function getStore(): Promise<Store> {
  if (!storeRef) {
    storeRef = await load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeRef;
}

export async function initVault() {
  try {
    const store = await getStore();
    const v = (await store.get(KEY)) as string | undefined;
    cached = v ?? null;
  } catch {
    cached = null;
  }
}

export function getVaultPath(): string | null {
  return cached;
}

export async function chooseVaultFolder(): Promise<string | null> {
  // Try Obsidian auto-detect first, before showing the directory picker.
  const detected = await detectObsidianVault();
  if (detected) {
    const useDetected = await confirm(
      `Found Obsidian vault:\n\n${detected.path}\n\nUse this as your vault folder?`,
      { title: "Vault detected", okLabel: "Use this", cancelLabel: "Choose another…" },
    );
    if (useDetected) {
      cached = detected.path;
      try {
        const store = await getStore();
        await store.set(KEY, detected.path);
      } catch {
        /* ignore */
      }
      return detected.path;
    }
  }

  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Select your Obsidian vault folder",
  });
  if (typeof selected !== "string") return null;
  cached = selected;
  try {
    const store = await getStore();
    await store.set(KEY, selected);
  } catch {
    /* ignore */
  }
  return selected;
}

export async function addCurrentToVault(srcPath: string | null) {
  if (!srcPath) {
    showToast("No file open to add", "error");
    return;
  }
  let vault = getVaultPath();
  if (!vault) {
    showToast("Select your vault folder first", "info");
    vault = await chooseVaultFolder();
    if (!vault) return;
  }

  try {
    const result = await invoke<string>("copy_to_vault", {
      src: srcPath,
      vault,
      onConflict: "rename",
    });
    showToast(
      `Added to vault: ${result.split("/").pop()}`,
      "success",
      [{ label: "Reveal in Finder", action: () => invoke("reveal_in_finder", { path: result }) }],
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("exists") || msg.toLowerCase().includes("already")) {
      const choice = await askConflict();
      if (choice === "cancel") return;
      try {
        const result = await invoke<string>("copy_to_vault", {
          src: srcPath,
          vault,
          onConflict: choice,
        });
        showToast(
          `Added to vault: ${result.split("/").pop()}`,
          "success",
          [{ label: "Reveal in Finder", action: () => invoke("reveal_in_finder", { path: result }) }],
        );
      } catch (err2) {
        showToast(`Failed to add: ${err2}`, "error");
      }
    } else {
      showToast(`Failed to add: ${err}`, "error");
    }
  }
}

async function askConflict(): Promise<"replace" | "rename" | "cancel"> {
  const replace = await ask("A file with this name already exists. Replace it?", {
    title: "Add to Vault — conflict",
    kind: "warning",
    okLabel: "Replace",
    cancelLabel: "Keep both (rename)",
  });
  return replace ? "replace" : "rename";
}
