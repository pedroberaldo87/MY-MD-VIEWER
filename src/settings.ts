import { chooseVaultFolder, detectObsidianVault, getVaultPath, initVault } from "./vault";
import { getThemePref, setThemePref } from "./theme";
import type { ThemePref } from "./types";

let overlay: HTMLElement | null = null;

export function initSettings() {
  overlay = document.getElementById("settings-overlay");
  if (!overlay) return;

  document.getElementById("settings-close")?.addEventListener("click", closeSettings);
  document.getElementById("settings-vault-change")?.addEventListener("click", async () => {
    const picked = await chooseVaultFolder();
    if (picked) updateVaultLabel(picked);
  });
  const themeSelect = document.getElementById("settings-theme") as HTMLSelectElement | null;
  themeSelect?.addEventListener("change", () => {
    setThemePref(themeSelect.value as ThemePref);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSettings();
  });
}

export async function openSettings() {
  if (!overlay) return;
  await initVault();
  updateVaultLabel(getVaultPath());
  const themeSelect = document.getElementById("settings-theme") as HTMLSelectElement | null;
  if (themeSelect) themeSelect.value = getThemePref();

  // Surface the auto-detected vault when nothing is configured yet
  const hint = document.getElementById("settings-vault-hint");
  if (hint) {
    if (!getVaultPath()) {
      const detected = await detectObsidianVault();
      if (detected) {
        hint.textContent = `Detected from Obsidian: ${detected.path}`;
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    } else {
      hint.hidden = true;
    }
  }

  overlay.hidden = false;
  overlay.style.display = "";
}

export function closeSettings() {
  if (!overlay) return;
  overlay.hidden = true;
  // Belt-and-suspenders: also force display:none in case some CSS specificity
  // beats the [hidden] rule.
  overlay.style.display = "none";
}

function updateVaultLabel(path: string | null) {
  const el = document.getElementById("settings-vault-path");
  if (!el) return;
  el.textContent = path ?? "Not configured";
  el.title = path ?? "";
}
