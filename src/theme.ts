import { load, type Store } from "@tauri-apps/plugin-store";
import type { ThemePref } from "./types";

const STORE_FILE = "settings.json";
const KEY = "theme";

let storeRef: Store | null = null;
let currentPref: ThemePref = "system";
const listeners = new Set<(theme: "light" | "dark") => void>();

async function getStore(): Promise<Store> {
  if (!storeRef) {
    storeRef = await load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeRef;
}

export async function initTheme() {
  try {
    const store = await getStore();
    const stored = (await store.get(KEY)) as ThemePref | undefined;
    if (stored === "light" || stored === "dark" || stored === "system") {
      currentPref = stored;
    }
  } catch (err) {
    console.warn("theme: failed to load preference", err);
  }
  applyTheme();

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handle = () => {
    if (currentPref === "system") applyTheme();
  };
  if (mq.addEventListener) mq.addEventListener("change", handle);
  else mq.addListener?.(handle);
}

export function getThemePref(): ThemePref {
  return currentPref;
}

export async function setThemePref(pref: ThemePref) {
  currentPref = pref;
  try {
    const store = await getStore();
    await store.set(KEY, pref);
  } catch (err) {
    console.warn("theme: failed to persist preference", err);
  }
  applyTheme();
}

export function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;
  for (const fn of listeners) fn(resolved);
}

function resolveTheme(): "light" | "dark" {
  if (currentPref === "light") return "light";
  if (currentPref === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function onThemeChange(fn: (theme: "light" | "dark") => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
