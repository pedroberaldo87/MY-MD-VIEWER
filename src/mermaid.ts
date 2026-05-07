import mermaid from "mermaid";

let initialized = false;
let currentTheme: "default" | "dark" = "default";

function initMermaid(theme: "default" | "dark") {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
    fontFamily: "var(--font-prose)",
  });
  initialized = true;
  currentTheme = theme;
}

export async function renderMermaidIn(container: HTMLElement, isDark: boolean) {
  const wantedTheme = isDark ? "dark" : "default";
  if (!initialized || currentTheme !== wantedTheme) {
    initMermaid(wantedTheme);
  }

  const sources = Array.from(
    container.querySelectorAll<HTMLDivElement>("div.mermaid-source"),
  );
  if (sources.length === 0) return;

  for (let i = 0; i < sources.length; i++) {
    const node = sources[i];
    const raw = node.dataset.source ? decodeURIComponent(node.dataset.source) : node.textContent ?? "";
    const id = `mermaid-${Date.now()}-${i}`;
    try {
      const { svg, bindFunctions } = await mermaid.render(id, raw);
      const wrapper = document.createElement("div");
      wrapper.className = "mermaid";
      wrapper.innerHTML = svg;
      if (bindFunctions) bindFunctions(wrapper);
      node.replaceWith(wrapper);
    } catch (err) {
      const errBlock = document.createElement("pre");
      errBlock.className = "mermaid-error";
      errBlock.textContent = `Mermaid error: ${err instanceof Error ? err.message : String(err)}\n\n${raw}`;
      node.replaceWith(errBlock);
    }
  }
}
