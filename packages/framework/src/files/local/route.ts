/**
 * The local transfer route (files.md §2 "Local"): checks a signed local ticket and streams the
 * body to or from local storage through the request's `FilesService`. Its responses always carry
 * `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, plus
 * `Content-Disposition: attachment` for anything but raster images, so uploaded HTML or SVG never
 * runs as the app's origin. It sends no CORS headers: other origins cannot use it.
 * Refusals are plain 403 / 404 responses and are not logged (ticket URLs never reach the log).
 * LOCAL ONLY (CORE-REQ-006).
 */
import type { Context, Hono } from "hono";
import type { RuntimeEnv } from "../../core/assemble.js";
import { LOCAL_TRANSFER_PATH, verifyLocalTicket } from "./tickets.js";

/** Raster image types a browser renders without running content; served inline. */
const RASTER_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

const SAFE_HEADERS = { "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } as const;

export interface LocalTransferRouteOptions {
  /** The framework-internal local signing secret. */
  readonly key: (c: Context<RuntimeEnv>) => Promise<string>;
}

function mediaType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

/** Registers the route on the framework's `/api` router. */
export function registerLocalTransferRoute(api: Hono<RuntimeEnv>, options: LocalTransferRouteOptions): void {
  const path = `${LOCAL_TRANSFER_PATH.slice("/api".length)}:token`;
  const refuse = (c: Context<RuntimeEnv>, status: 403 | 404) => c.body(null, status, SAFE_HEADERS);

  api.put(path, async (c) => {
    const grant = await verifyLocalTicket(c.req.param("token") ?? "", await options.key(c));
    if (grant === undefined || grant.op !== "upload" || c.req.header("Content-Type") !== grant.contentType) return refuse(c, 403);
    // Buffered: R2's binding needs a stream of known length, which a body in the Node test
    // process is not; local only, where memory is the machine's (DEC-PENDING-B-11-4).
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    await c.var.files.put(grant.name, bytes, { contentType: grant.contentType });
    return c.body(null, 200, SAFE_HEADERS);
  });

  api.get(path, async (c) => {
    const grant = await verifyLocalTicket(c.req.param("token") ?? "", await options.key(c));
    if (grant === undefined || grant.op !== "download") return refuse(c, 403);
    const file = await c.var.files.get(grant.name);
    if (file === null) return refuse(c, 404);
    const headers: Record<string, string> = { ...SAFE_HEADERS, "Content-Type": file.contentType, "Content-Length": String(file.size) };
    if (!RASTER_IMAGES.has(mediaType(file.contentType))) headers["Content-Disposition"] = "attachment";
    return c.body(file.body, 200, headers);
  });
}
