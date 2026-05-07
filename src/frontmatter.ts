import type { Frontmatter } from "./types";

// A pragmatic YAML subset parser tuned for typical Markdown frontmatter:
// - top-level scalar keys (string, number, boolean)
// - inline arrays: [a, b, c]
// - block sequences: keys followed by lines starting with "- "
// Anything more exotic is preserved as raw and shown as a code block.
export function parseFrontmatter(raw: string): Frontmatter {
  const data: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);

  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  const flush = () => {
    if (currentKey !== null && currentList !== null) {
      data[currentKey] = currentList;
    }
    currentKey = null;
    currentList = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const seqMatch = line.match(/^\s*-\s+(.*)$/);
    if (seqMatch && currentKey !== null) {
      if (currentList === null) currentList = [];
      currentList.push(stripQuotes(seqMatch[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (kv) {
      flush();
      const key = kv[1];
      const value = kv[2].trim();
      if (value === "") {
        currentKey = key;
        currentList = null;
        continue;
      }
      if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        const items = inner ? splitCsv(inner).map(stripQuotes) : [];
        data[key] = items;
        continue;
      }
      data[key] = coerceScalar(value);
    }
  }
  flush();
  return { raw, data };
}

function splitCsv(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote: string | null = null;
  for (const ch of s) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        buf += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ",") {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function coerceScalar(v: string): unknown {
  const stripped = stripQuotes(v);
  if (stripped !== v) return stripped;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  return v;
}

export function renderFrontmatterBlock(fm: Frontmatter | null): string {
  if (!fm) return "";
  const entries = Object.entries(fm.data);
  if (entries.length === 0) return "";

  const rows: string[] = [];
  for (const [key, value] of entries) {
    rows.push(`<div class="fm-row"><div class="fm-key">${escapeHtml(key)}</div>${renderValue(key, value)}</div>`);
  }
  return `<aside class="frontmatter">${rows.join("")}</aside>`;
}

function renderValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (key.toLowerCase() === "tags" || key.toLowerCase() === "aliases") {
      return `<div class="fm-value">${value
        .map((v) => `<span class="fm-chip">${escapeHtml(String(v))}</span>`)
        .join("")}</div>`;
    }
    return `<div class="fm-value">${value.map((v) => `<span>${escapeHtml(String(v))}</span>`).join(", ")}</div>`;
  }
  if (value === null || value === undefined) {
    return `<div class="fm-value fm-null">—</div>`;
  }
  return `<div class="fm-value">${escapeHtml(String(value))}</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
