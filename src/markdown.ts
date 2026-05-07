import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import hljs from "highlight.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Frontmatter, RenderResult } from "./types";
import { parseFrontmatter } from "./frontmatter";

import frontMatterPlugin from "markdown-it-front-matter";
import taskListsPlugin from "markdown-it-task-lists";
import katexPlugin from "@vscode/markdown-it-katex";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight: (str: string, lang: string) => {
    if (lang === "mermaid") {
      // Defer to mermaid post-render. Encode the code so we don't lose it.
      return `<div class="mermaid-source" data-source="${encodeURIComponent(str)}">${escapeHtml(str)}</div>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code class="language-${lang}">${
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
        }</code></pre>`;
      } catch {
        // fall through
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
  },
});

let capturedFrontmatter: Frontmatter | null = null;

md.use(frontMatterPlugin, (raw: string) => {
  capturedFrontmatter = parseFrontmatter(raw);
});

md.use(anchor, {
  permalink: anchor.permalink.linkInsideHeader({
    symbol: "#",
    placement: "before",
    ariaHidden: true,
  }),
  level: [1, 2, 3, 4],
  slugify: (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-"),
});

md.use(taskListsPlugin, { enabled: true, label: false });

md.use(katexPlugin, {
  throwOnError: false,
  errorColor: "var(--color-danger)",
});

// Linkify URLs without scheme — but skip for relative image paths handled below.
md.linkify.set({ fuzzyEmail: false });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Override image renderer to resolve relative paths against the file's directory.
// External http(s) URLs and data: URIs pass through untouched.
const defaultImageRender =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const srcIdx = token.attrIndex("src");
  if (srcIdx >= 0 && token.attrs) {
    const src = token.attrs[srcIdx][1];
    if (src && !/^(https?:|data:|asset:|tauri:)/.test(src)) {
      const baseDir: string | undefined = env?.baseDir;
      if (baseDir) {
        const absolute = resolveRelativePath(baseDir, src);
        try {
          token.attrs[srcIdx][1] = convertFileSrc(absolute);
        } catch {
          // leave as-is
        }
      }
    }
  }
  return defaultImageRender(tokens, idx, options, env, self);
};

function resolveRelativePath(baseDir: string, rel: string): string {
  // Strip query/hash for path resolution, re-attach later.
  const [pathPart, ...rest] = rel.split(/([?#].*)$/);
  const tail = rest.join("");
  const segments = pathPart.split("/").filter((s) => s !== "" && s !== ".");
  const baseSegments = baseDir.replace(/\/+$/, "").split("/");
  for (const seg of segments) {
    if (seg === "..") baseSegments.pop();
    else baseSegments.push(seg);
  }
  return baseSegments.join("/") + tail;
}

export function renderMarkdown(content: string, baseDir: string | null): RenderResult {
  capturedFrontmatter = null;
  const env = baseDir ? { baseDir } : {};
  const html = md.render(content, env);
  return { html, frontmatter: capturedFrontmatter };
}
