import { ApiError } from "@lago-morph/prototype-framework/client";

/** Creates an element with text content (never HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/** A readable message for a failed call, including the request ID to look up in the log. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId === null ? `${error.code}: ${error.message}` : `${error.code}: ${error.message} (request ${error.requestId})`;
  }
  return error instanceof Error ? error.message : String(error);
}
