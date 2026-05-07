interface TocEntry {
  id: string;
  text: string;
  level: number;
  el: HTMLElement;
}

let observer: IntersectionObserver | null = null;
let entries: TocEntry[] = [];

export function rebuildToc(content: HTMLElement, list: HTMLElement, aside: HTMLElement) {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  list.innerHTML = "";
  entries = [];

  const headings = Array.from(
    content.querySelectorAll<HTMLElement>("h1, h2, h3"),
  ).filter((h) => h.id);

  if (headings.length === 0) {
    aside.dataset.empty = "true";
    return;
  }
  aside.dataset.empty = "false";

  for (const h of headings) {
    const level = Number.parseInt(h.tagName.substring(1), 10);
    const item = document.createElement("a");
    item.className = `toc-item toc-l${level}`;
    item.href = `#${h.id}`;
    item.textContent = (h.textContent ?? "").replace(/^#\s*/, "").trim();
    item.dataset.target = h.id;
    item.addEventListener("click", (ev) => {
      ev.preventDefault();
      h.scrollIntoView({ behavior: "smooth", block: "start" });
      // Update hash without jump
      history.replaceState(null, "", `#${h.id}`);
    });
    list.appendChild(item);
    entries.push({ id: h.id, text: item.textContent, level, el: h });
  }

  observer = new IntersectionObserver(
    (records) => {
      for (const r of records) {
        if (r.isIntersecting) {
          setActive(r.target.id);
          break;
        }
      }
    },
    {
      rootMargin: "-10% 0px -75% 0px",
      threshold: [0, 0.5, 1],
    },
  );
  for (const e of entries) observer.observe(e.el);
}

function setActive(id: string) {
  const list = document.getElementById("toc-list");
  if (!list) return;
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement) {
      child.classList.toggle("active", child.dataset.target === id);
    }
  }
}

export function toggleToc() {
  const aside = document.getElementById("toc");
  if (!aside) return;
  aside.hidden = !aside.hidden;
  document.documentElement.classList.toggle("toc-open", !aside.hidden);
}
