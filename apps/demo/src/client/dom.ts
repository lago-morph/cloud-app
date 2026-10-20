import { ApiError } from "@lago-morph/prototype-framework/client";

/** Creates an element with text content (never HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/** A titled section of the page. */
export function section(title: string): HTMLElement {
  const node = el("section");
  node.append(el("h2", title));
  return node;
}

/** A same-origin link handled by the client router. */
export function link(text: string, href: string): HTMLAnchorElement {
  const a = el("a", text);
  a.href = href;
  return a;
}

/** A button that runs `action` and shows its failure in `message`. */
export function button(text: string, message: HTMLElement, action: () => Promise<void>): HTMLButtonElement {
  const node = el("button", text);
  node.type = "button";
  node.addEventListener("click", () => {
    message.textContent = "";
    void action().catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  });
  return node;
}

/** A readable message for a failed call, including the request ID to look up in the log. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId === null ? `${error.code}: ${error.message}` : `${error.code}: ${error.message} (request ${error.requestId})`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
