import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import Fuse from "fuse.js";
import type { RecentFile } from "./types";

const STORE_FILE = "settings.json";
const KEY = "recent_files";
const MAX_RECENTS = 50;

let storeRef: Store | null = null;
let cache: RecentFile[] = [];
let fuse: Fuse<RecentFile> | null = null;

async function getStore(): Promise<Store> {
  if (!storeRef) {
    storeRef = await load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeRef;
}

export async function initRecents() {
  try {
    const store = await getStore();
    const list = ((await store.get(KEY)) as RecentFile[] | undefined) ?? [];
    cache = sanitize(list);
    rebuildFuse();
  } catch (err) {
    console.warn("recent: failed to load", err);
    cache = [];
  }
}

export async function pushRecent(path: string, name: string) {
  const now = Date.now();
  cache = [{ path, name, lastOpenedAt: now }, ...cache.filter((r) => r.path !== path)].slice(
    0,
    MAX_RECENTS,
  );
  rebuildFuse();
  try {
    const store = await getStore();
    await store.set(KEY, cache);
  } catch (err) {
    console.warn("recent: failed to persist", err);
  }
}

export async function pruneMissing() {
  const checks = await Promise.all(
    cache.map(async (r) => {
      try {
        const ok = await invoke<boolean>("path_exists", { path: r.path });
        return ok ? r : null;
      } catch {
        return r;
      }
    }),
  );
  cache = checks.filter((r): r is RecentFile => r !== null);
  rebuildFuse();
  try {
    const store = await getStore();
    await store.set(KEY, cache);
  } catch {
    /* ignore */
  }
}

export function searchRecents(query: string): RecentFile[] {
  if (!query.trim()) return cache.slice(0, 30);
  if (!fuse) return [];
  return fuse.search(query, { limit: 30 }).map((r) => r.item);
}

export function allRecents(): RecentFile[] {
  return cache.slice();
}

function sanitize(list: unknown): RecentFile[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (it): it is RecentFile =>
        typeof it === "object" &&
        it !== null &&
        typeof (it as RecentFile).path === "string" &&
        typeof (it as RecentFile).name === "string" &&
        typeof (it as RecentFile).lastOpenedAt === "number",
    )
    .slice(0, MAX_RECENTS);
}

function rebuildFuse() {
  fuse = new Fuse(cache, {
    keys: ["name", "path"],
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true,
  });
}
