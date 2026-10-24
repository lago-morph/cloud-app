/**
 * FILES-AC-006, server part (Where: Local): with storage unreachable, every server operation
 * fails with `FILES.UNAVAILABLE` (docs/components/files.md FILES-REQ-006). A running `dev`
 * server cannot be given unreachable storage, so this part runs the reference app in-process
 * with `createTestApp(…, { unavailable: ["files"] })` (testing.d.ts), through the same
 * `/api/files/*` routes. The driver selects it on the local target only (Where: Local).
 * The browser part (an interrupted transfer) is transfers.spec.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { disposeReference, openReference } from "./in-process.js";

const ERROR = { code: "FILES.UNAVAILABLE", status: 503 };

afterEach(disposeReference);

describe("FILES-AC-006 storage unreachable", () => {
  it(tag("FILES-AC-006", "server part (in-process): with storage unreachable, put, get, head, delete, list and both ticket kinds fail with FILES.UNAVAILABLE"), async () => {
    const app = await openReference({ unavailable: ["files"], user: { level: "user", id: "c-t3-ac006", displayName: null } });
    const name = encodeURIComponent("c-t3/ac006/f.bin");
    const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const calls: [string, Promise<Response>][] = [
      ["put", app.request("/api/files/content", json("PUT", { name: "c-t3/ac006/f.bin", base64: "AQID" }))],
      ["get", app.request(`/api/files/content?name=${name}`)],
      ["head", app.request(`/api/files/head?name=${name}`)],
      ["delete", app.request(`/api/files/content?name=${name}`, { method: "DELETE" })],
      ["list", app.request(`/api/files/list?prefix=${encodeURIComponent("c-t3/ac006/")}`)],
      ["upload ticket", app.request("/api/files/upload-ticket", json("POST", { name: "c-t3/ac006/f.bin" }))],
      ["download ticket", app.request("/api/files/download-ticket", json("POST", { name: "c-t3/ac006/f.bin" }))],
    ];
    for (const [op, pending] of calls) {
      const res = await pending;
      const body = (await res.json()) as { error?: { code?: string } };
      expect({ op, status: res.status, code: body.error?.code }).toStrictEqual({ op, status: ERROR.status, code: ERROR.code });
    }
  });
});
