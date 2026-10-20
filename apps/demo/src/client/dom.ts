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

/** A same-origin link whose text is set as text. */
export function link(href: string, text: string): HTMLAnchorElement {
  const node = el("a", text);
  node.href = href;
  return node;
}

/** A readable message for a failed call, including the request ID to look up in the log. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId === null ? `${error.code}: ${error.message}` : `${error.code}: ${error.message} (request ${error.requestId})`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Runs a promise and shows its failure in `message`. */
export function report(message: HTMLElement, work: Promise<unknown>): void {
  void work.catch((error: unknown) => {
    message.textContent = describeError(error);
  });
}

export function when(time: number): string {
  return new Date(time).toLocaleString();
}
