declare module "markdown-it-front-matter" {
  import type { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<(fm: string) => void>;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  import type { PluginSimple, PluginWithOptions } from "markdown-it";
  const plugin: PluginSimple | PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}

declare module "@vscode/markdown-it-katex" {
  import type { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<Record<string, unknown>>;
  export default plugin;
}

declare module "markdown-it-highlightjs" {
  import type { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<{ hljs?: unknown; auto?: boolean; code?: boolean }>;
  export default plugin;
}
