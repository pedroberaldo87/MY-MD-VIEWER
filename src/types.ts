export interface MarkdownFile {
  content: string;
  dir: string;
  name: string;
  mtime: number;
}

export interface RecentFile {
  path: string;
  name: string;
  lastOpenedAt: number;
}

export type ThemePref = "system" | "light" | "dark";

export interface Frontmatter {
  raw: string;
  data: Record<string, unknown>;
}

export interface RenderResult {
  html: string;
  frontmatter: Frontmatter | null;
}

declare global {
  interface Window {
    __MD_VIEWER__: {
      currentFilePath: string | null;
      currentFileDir: string | null;
    };
  }
}
