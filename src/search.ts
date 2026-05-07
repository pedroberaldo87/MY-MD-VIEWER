interface SearchState {
  query: string;
  hits: HTMLElement[];
  active: number;
}

const state: SearchState = {
  query: "",
  hits: [],
  active: -1,
};

let overlay: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let counter: HTMLElement | null = null;

export function initSearch() {
  overlay = document.getElementById("search-overlay");
  input = document.getElementById("search-input") as HTMLInputElement | null;
  counter = document.getElementById("search-counter");

  if (!overlay || !input || !counter) return;

  input.addEventListener("input", () => {
    state.query = input!.value;
    runSearch();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) navigate(-1);
      else navigate(1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  });

  document.getElementById("search-prev")?.addEventListener("click", () => navigate(-1));
  document.getElementById("search-next")?.addEventListener("click", () => navigate(1));
  document.getElementById("search-close")?.addEventListener("click", () => closeSearch());
}

export function openSearch() {
  if (!overlay || !input) return;
  overlay.hidden = false;
  input.focus();
  input.select();
}

export function closeSearch() {
  if (!overlay) return;
  overlay.hidden = true;
  clearMarks();
  state.query = "";
  state.hits = [];
  state.active = -1;
  if (input) input.value = "";
  updateCounter();
}

function runSearch() {
  clearMarks();
  state.hits = [];
  state.active = -1;

  const q = state.query.trim();
  if (q.length < 1) {
    updateCounter();
    return;
  }

  const root = document.getElementById("content");
  if (!root) return;

  const lowerQ = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Skip script/style/code that we already processed
      if (parent.closest(".search-overlay")) return NodeFilter.FILTER_REJECT;
      if (parent.tagName === "SCRIPT" || parent.tagName === "STYLE") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue && node.nodeValue.toLowerCase().includes(lowerQ)) {
      targets.push(node as Text);
    }
  }

  for (const text of targets) {
    highlightOccurrences(text, lowerQ);
  }

  if (state.hits.length > 0) {
    state.active = 0;
    setActive();
  }
  updateCounter();
}

function highlightOccurrences(textNode: Text, lowerQ: string) {
  const value = textNode.nodeValue!;
  const lower = value.toLowerCase();
  const parts: (string | HTMLElement)[] = [];
  let i = 0;
  let from = 0;
  while ((i = lower.indexOf(lowerQ, from)) !== -1) {
    if (i > from) parts.push(value.slice(from, i));
    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = value.slice(i, i + lowerQ.length);
    parts.push(mark);
    state.hits.push(mark);
    from = i + lowerQ.length;
  }
  if (parts.length === 0) return;
  if (from < value.length) parts.push(value.slice(from));

  const frag = document.createDocumentFragment();
  for (const p of parts) {
    if (typeof p === "string") frag.appendChild(document.createTextNode(p));
    else frag.appendChild(p);
  }
  textNode.replaceWith(frag);
}

function navigate(dir: 1 | -1) {
  if (state.hits.length === 0) return;
  state.active = (state.active + dir + state.hits.length) % state.hits.length;
  setActive();
}

function setActive() {
  for (let i = 0; i < state.hits.length; i++) {
    state.hits[i].classList.toggle("active", i === state.active);
  }
  if (state.active >= 0) {
    state.hits[state.active].scrollIntoView({ behavior: "smooth", block: "center" });
  }
  updateCounter();
}

function updateCounter() {
  if (!counter) return;
  if (state.hits.length === 0) {
    counter.textContent = state.query ? "0 / 0" : "";
  } else {
    counter.textContent = `${state.active + 1} / ${state.hits.length}`;
  }
}

function clearMarks() {
  for (const m of state.hits) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
    parent.normalize();
  }
}
