// Link policy for rendered Markdown. Pure functions (no Tauri imports) so the
// policy can be unit-tested.

export type LinkAction =
  | { kind: "external"; url: string } // open in the default browser / mail client
  | { kind: "anchor"; id: string } // scroll inside the current document
  | { kind: "markdown"; path: string } // open another Markdown file in the viewer
  | { kind: "ignore" }; // do nothing (and never navigate the window)

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mdwn|mkdn)$/i;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** Resolve `rel` against the directory `baseDir` (POSIX paths). Query/hash are kept. */
export function resolveRelativePath(baseDir: string, rel: string): string {
  const [pathPart, ...rest] = rel.split(/([?#].*)$/);
  const tail = rest.join("");
  const segments = pathPart.split("/").filter((s) => s !== "" && s !== ".");
  const baseSegments = baseDir.replace(/\/+$/, "").split("/");
  for (const seg of segments) {
    if (seg === "..") {
      if (baseSegments.length > 1) baseSegments.pop();
    } else baseSegments.push(seg);
  }
  return baseSegments.join("/") + tail;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Decide what a click on `href` should do.
 *  - http(s) and mailto: -> external
 *  - #fragment -> anchor
 *  - relative path to a Markdown file -> markdown (resolved against baseDir)
 *  - everything else (javascript:, file:, data:, tauri:, asset:, protocol-relative,
 *    absolute paths, relative non-Markdown files, malformed input) -> ignore
 */
export function classifyLink(href: string | null | undefined, baseDir: string | null): LinkAction {
  if (!href) return { kind: "ignore" };
  const raw = href.trim();
  if (!raw) return { kind: "ignore" };
  // Control characters / whitespace tricks inside the scheme ("java\nscript:") -> ignore.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { kind: "ignore" };

  if (raw.startsWith("#")) {
    return { kind: "anchor", id: safeDecode(raw.slice(1)) };
  }

  if (raw.startsWith("//")) return { kind: "ignore" };

  const scheme = SCHEME.exec(raw);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    if (proto === "http" || proto === "https") {
      try {
        const u = new URL(raw);
        if (!u.hostname) return { kind: "ignore" };
        return { kind: "external", url: u.href };
      } catch {
        return { kind: "ignore" };
      }
    }
    if (proto === "mailto") {
      return raw.length > "mailto:".length ? { kind: "external", url: raw } : { kind: "ignore" };
    }
    return { kind: "ignore" };
  }

  // Relative reference.
  if (raw.startsWith("/") || !baseDir) return { kind: "ignore" };
  const pathOnly = raw.split(/[?#]/)[0];
  const decoded = safeDecode(pathOnly);
  if (!MARKDOWN_EXT.test(decoded)) return { kind: "ignore" };
  return { kind: "markdown", path: resolveRelativePath(baseDir, decoded) };
}
