import { invoke } from "@tauri-apps/api/core";
import { searchRecents, pruneMissing, allRecents } from "./recent";
import type { RecentFile } from "./types";

let overlay: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLElement | null = null;
let activeIndex = 0;
let visible: RecentFile[] = [];

export function initPalette() {
  overlay = document.getElementById("palette");
  input = document.getElementById("palette-input") as HTMLInputElement | null;
  list = document.getElementById("palette-list");

  if (!overlay || !input || !list) return;

  input.addEventListener("input", () => render(input!.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!overlay || overlay.hidden) return;
    if (e.target instanceof Node && !overlay.contains(e.target)) {
      closePalette();
    }
  });
}

export async function openPalette() {
  if (!overlay || !input) return;
  await pruneMissing();
  overlay.hidden = false;
  input.value = "";
  input.focus();
  render("");
}

export function closePalette() {
  if (!overlay) return;
  overlay.hidden = true;
}

function render(query: string) {
  if (!list) return;
  visible = query.trim() ? searchRecents(query) : allRecents().slice(0, 30);
  activeIndex = 0;
  list.innerHTML = "";
  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "palette-empty";
    empty.textContent = "No recent files";
    list.appendChild(empty);
    return;
  }
  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    const li = document.createElement("li");
    li.className = "palette-item" + (i === 0 ? " active" : "");
    li.dataset.index = String(i);

    const name = document.createElement("div");
    name.className = "palette-name";
    name.textContent = item.name;
    li.appendChild(name);

    const path = document.createElement("div");
    path.className = "palette-path";
    path.textContent = collapseHome(item.path);
    li.appendChild(path);

    li.addEventListener("click", () => {
      activeIndex = i;
      activate();
    });
    list.appendChild(li);
  }
}

function move(dir: 1 | -1) {
  if (visible.length === 0) return;
  activeIndex = (activeIndex + dir + visible.length) % visible.length;
  if (!list) return;
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.dataset.index !== undefined) {
      child.classList.toggle("active", Number.parseInt(child.dataset.index, 10) === activeIndex);
    }
  }
  const active = list.querySelector(".palette-item.active");
  if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" });
}

async function activate() {
  if (visible.length === 0) return;
  const item = visible[activeIndex];
  closePalette();
  try {
    await invoke("open_file_in_new_window", { path: item.path });
  } catch (err) {
    console.warn("palette: failed to open", err);
  }
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
