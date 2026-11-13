import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { classifyLink } from "./links";
import { showToast } from "./toast";

/**
 * Intercept every link click so the app window never navigates away from the
 * viewer. See links.ts for the policy.
 */
export function initLinkHandler(getBaseDir: () => string | null) {
  const handle = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const a = target.closest("a[href]");
    if (!a) return;

    // Always stop the webview's own navigation; act per policy instead.
    e.preventDefault();
    if (e.type === "auxclick" && e.button !== 1) return;

    const action = classifyLink(a.getAttribute("href"), getBaseDir());
    switch (action.kind) {
      case "external":
        void openUrl(action.url).catch((err) => {
          console.warn("openUrl failed", err);
          showToast("Could not open link");
        });
        break;
      case "anchor": {
        if (action.id === "") {
          document.getElementById("content")?.scrollIntoView({ block: "start" });
          break;
        }
        const el = document.getElementById(action.id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
      case "markdown":
        void invoke("open_file_in_new_window", { path: action.path }).catch((err) => {
          console.warn("open linked file failed", err);
          showToast("Could not open linked file");
        });
        break;
      default:
        break;
    }
  };
  document.addEventListener("click", handle);
  document.addEventListener("auxclick", handle);
}
