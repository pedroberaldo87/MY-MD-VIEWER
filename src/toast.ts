type ToastKind = "info" | "success" | "error";

interface ToastAction {
  label: string;
  action: () => void | Promise<void>;
}

let stack: HTMLElement | null = null;

function getStack(): HTMLElement {
  if (!stack) {
    stack = document.getElementById("toast-stack") ?? document.body;
  }
  return stack;
}

export function showToast(message: string, kind: ToastKind = "info", actions: ToastAction[] = []) {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  el.appendChild(text);

  for (const a of actions) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      a.action();
    });
    el.appendChild(btn);
  }

  const close = document.createElement("button");
  close.className = "toast-close";
  close.textContent = "✕";
  close.addEventListener("click", () => dismiss(el));
  el.appendChild(close);

  getStack().appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast-in"));
  setTimeout(() => dismiss(el), 6000);
}

function dismiss(el: HTMLElement) {
  el.classList.remove("toast-in");
  el.classList.add("toast-out");
  setTimeout(() => el.remove(), 200);
}
