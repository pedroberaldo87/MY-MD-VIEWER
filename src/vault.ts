import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./toast";

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

// The vault folder is owned by the Rust side: it is registered when the user
// picks it in a native dialog, and `copy_to_vault` only writes there.
export async function initVault() {
  try {
    cached = (await invoke<string | null>("get_vault_folder")) ?? null;
  } catch {
    cached = null;
  }
}

export function getVaultPath(): string | null {
  return cached;
}

export async function chooseVaultFolder(): Promise<string | null> {
  // Rust offers the Obsidian-detected vault first, then a folder picker.
  try {
    const chosen = await invoke<string | null>("choose_vault_folder");
    if (chosen) cached = chosen;
    return chosen ?? null;
  } catch (err) {
    showToast(`Could not set vault folder: ${err}`, "error");
    return null;
  }
}

export async function addCurrentToVault(srcPath: string | null) {
  if (!srcPath) {
    showToast("No file open to add", "error");
    return;
  }
  if (!getVaultPath()) {
    showToast("Select your vault folder first", "info");
    if (!(await chooseVaultFolder())) return;
  }

  try {
    const result = await invoke<string>("copy_to_vault", {
      src: srcPath,
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
