import { describe, expect, it } from "vitest";
import type { CloudflareApi } from "./api.js";
import { deleteObjects, listObjectKeys } from "./objects.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const BUCKET = `/accounts/${ACCOUNT}/r2/buckets/notes-test-abc-files`;

type Reply = { status: number; body: unknown };
const page = (keys: string[], cursor?: string): Reply => ({
  status: 200,
  body: { success: true, errors: [], messages: [], result: keys.map((key) => ({ key })), result_info: cursor ? { cursor, is_truncated: true } : { is_truncated: false } },
});
const err = (status: number, code: number, message: string): Reply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

/** An in-memory bucket behind the R2 object endpoints of api.cloudflare.com (A-01 cleanup_state.py shapes). */
function bucketApi(initial: string[], options: { pageSize?: number; failDelete?: (key: string) => Reply | undefined } = {}): CloudflareApi & { requests: string[]; keys: Set<string> } {
  const keys = new Set(initial);
  const requests: string[] = [];
  const api = async (method: string, path: string) => {
    requests.push(`${method} ${path}`);
    const url = new URL(`https://x${path}`);
    if (method === "GET" && url.pathname === `${BUCKET}/objects`) {
      const all = [...keys].sort();
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const size = options.pageSize ?? 1000;
      const slice = all.slice(start, start + size);
      return page(slice, start + size < all.length ? String(start + size) : undefined);
    }
    if (method === "DELETE" && url.pathname.startsWith(`${BUCKET}/objects/`)) {
      const key = decodeURIComponent(url.pathname.slice(`${BUCKET}/objects/`.length));
      keys.delete(key);
      return options.failDelete?.(key) ?? { status: 200, body: { success: true, errors: [], messages: [], result: {} } };
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  return Object.assign(api, { requests, keys });
}

describe("R2 objects through api.cloudflare.com (emptying a stage bucket; SST state objects, DEC-0084)", () => {
  it("lists every key, following the cursor across pages", async () => {
    const api = bucketApi(["a", "b", "c"], { pageSize: 2 });
    expect(await listObjectKeys(api, ACCOUNT, "notes-test-abc-files")).toEqual(["a", "b", "c"]);
    expect(api.requests).toEqual([`GET ${BUCKET}/objects?per_page=1000`, `GET ${BUCKET}/objects?per_page=1000&cursor=2`]);
  });

  it("a bucket that does not exist has no objects", async () => {
    const api: CloudflareApi = async () => err(404, 10006, "The specified bucket does not exist.");
    expect(await listObjectKeys(api, ACCOUNT, "gone")).toEqual([]);
  });

  it("deletes each key by its encoded name", async () => {
    const api = bucketApi(["uploads/a b.png", "x"]);
    await deleteObjects(api, ACCOUNT, "notes-test-abc-files", ["uploads/a b.png", "x"]);
    expect(api.requests).toEqual([`DELETE ${BUCKET}/objects/uploads%2Fa%20b.png`, `DELETE ${BUCKET}/objects/x`]);
    expect(api.keys.size).toBe(0);
  });

  it("an error answer to a delete is not proof the object remains: only keys still listed afterwards fail (A-03 c19: a 502 on a delete that happened)", async () => {
    const api = bucketApi(["a", "b"], { failDelete: (k) => (k === "a" ? { status: 502, body: "upstream request failed" } : undefined) });
    await deleteObjects(api, ACCOUNT, "notes-test-abc-files", ["a", "b"]);

    const stuck = bucketApi(["a", "b"]);
    const real = stuck as CloudflareApi;
    const keepA: CloudflareApi = async (method, path, body) => {
      if (method === "DELETE" && path.endsWith("/objects/a")) return err(403, 10002, "Unauthorized");
      return real(method, path, body);
    };
    await expect(deleteObjects(keepA, ACCOUNT, "notes-test-abc-files", ["a", "b"])).rejects.toThrow(
      /R2 bucket notes-test-abc-files: 1 object\(s\) could not be deleted \(a: HTTP 403: Unauthorized \(code 10002\)\)/,
    );
  });
});
