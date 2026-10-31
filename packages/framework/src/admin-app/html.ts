/**
 * The admin app's HTML: one small layout, escaped text, strict headers. Pages are plain forms; a
 * page may add one inline script, allowed by the response's CSP nonce.
 */

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** `text` escaped for HTML text and attribute values. */
export const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

const STYLE = "body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.5}code,pre{background:#f3f3f3;padding:.1rem .3rem}pre{padding:.6rem;white-space:pre-wrap;word-break:break-all}.warn{color:#8a3b00}nav form{display:inline}";

export interface PageOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** One inline script, run under the CSP nonce. */
  readonly script?: string;
}

/** A full HTML page. `body` is trusted HTML: callers escape what they put in it. */
export function page(title: string, body: string, options: PageOptions = {}): Response {
  const nonce = options.script === undefined ? undefined : crypto.randomUUID().replace(/-/g, "");
  const csp = ["default-src 'none'", "style-src 'unsafe-inline'", "base-uri 'none'", "frame-ancestors 'none'", ...(nonce === undefined ? [] : [`script-src 'nonce-${nonce}'`])].join("; ");
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · Prototype admin</title><style>${STYLE}</style></head>`,
    `<body><h1>${esc(title)}</h1>`,
    body,
    nonce === undefined ? "" : `<script nonce="${nonce}">${options.script ?? ""}</script>`,
    "</body></html>",
    "",
  ].join("\n");
  return new Response(html, { status: options.status ?? 200, headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": csp, ...options.headers } });
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });

/** A form with one button that POSTs to `action`. */
export const button = (action: string, label: string): string => `<form method="post" action="${esc(action)}"><button type="submit">${esc(label)}</button></form>`;
