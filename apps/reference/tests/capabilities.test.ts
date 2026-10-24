import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import type { FilePage } from "../src/shared/types";
import { json, open, type ErrorBody } from "./support";

describe("KV routes", () => {
  it("refuse anonymous callers", async () => {
    const t = await open();
    expect((await t.request("/api/kv/value?key=a")).status).toBe(401);
  });

  it("put, get, list, delete", async () => {
    const t = await open({ user: mockUsers.user("kv") });
    expect(await (await t.request("/api/kv/value?key=k%251")).json()).toEqual({ value: null });
    expect((await t.request("/api/kv/value", json("PUT", { key: "k%1", value: "one" }))).status).toBe(204);
    expect((await t.request("/api/kv/value", json("PUT", { key: "k_2", value: "two" }))).status).toBe(204);
    expect(await (await t.request("/api/kv/value?key=k%251")).json()).toEqual({ value: "one" });
    const page: { items: unknown[]; nextCursor: string | null } = await (await t.request("/api/kv/list?prefix=k&limit=1")).json();
    expect(page.items).toEqual([{ key: "k%1", value: "one" }]);
    expect(page.nextCursor).not.toBeNull();
    const next = await (await t.request(`/api/kv/list?prefix=k&limit=1&cursor=${encodeURIComponent(page.nextCursor ?? "")}`)).json();
    expect(next).toEqual({ items: [{ key: "k_2", value: "two" }], nextCursor: null });
    expect((await t.request("/api/kv/value?key=k%251", { method: "DELETE" })).status).toBe(204);
    expect(await (await t.request("/api/kv/value?key=k%251")).json()).toEqual({ value: null });
  });

  it("passes invalid keys to the framework", async () => {
    const t = await open({ user: mockUsers.user("kv") });
    const res = await t.request("/api/kv/value", json("PUT", { key: "", value: "x" }));
    expect(res.status).toBe(400);
    const body: ErrorBody = await res.json();
    expect(body.error.code).toBe("KV.INVALID_KEY");
  });
});

describe("files routes", () => {
  it("refuse anonymous callers", async () => {
    const t = await open();
    expect((await t.request("/api/files/list?prefix=")).status).toBe(401);
  });

  it("put, head, get, list, delete with exact names and bytes", async () => {
    const t = await open({ user: mockUsers.user("files") });
    const name = "dir/with space/%_ü..x.bin";
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    const base64 = btoa(String.fromCharCode(...bytes));
    const q = encodeURIComponent(name);
    expect((await t.request("/api/files/content", json("PUT", { name, contentType: "application/x-test", base64 }))).status).toBe(204);
    expect(await (await t.request(`/api/files/head?name=${q}`)).json()).toEqual({ file: { name, size: 5, contentType: "application/x-test" } });
    expect(await (await t.request(`/api/files/content?name=${q}`)).json()).toEqual({ file: { name, size: 5, contentType: "application/x-test", base64 } });
    const page: FilePage = await (await t.request("/api/files/list?prefix=dir%2F")).json();
    expect(page).toEqual({ items: [{ name, size: 5, contentType: "application/x-test" }], nextCursor: null });
    expect((await t.request(`/api/files/content?name=${q}`, { method: "DELETE" })).status).toBe(204);
    expect(await (await t.request(`/api/files/head?name=${q}`)).json()).toEqual({ file: null });
    expect(await (await t.request(`/api/files/content?name=${q}`)).json()).toEqual({ file: null });
  });

  it("issues upload and download tickets", async () => {
    const t = await open({ user: mockUsers.user("files") });
    const up = await t.request("/api/files/upload-ticket", json("POST", { name: "t/a.txt", contentType: "text/plain" }));
    expect(up.status).toBe(200);
    expect(await up.json()).toHaveProperty("ticket");
    const missing = await t.request("/api/files/download-ticket", json("POST", { name: "t/a.txt" }));
    expect(missing.status).toBe(404);
    await t.request("/api/files/content", json("PUT", { name: "t/a.txt", contentType: "text/plain", base64: btoa("hi") }));
    const down = await t.request("/api/files/download-ticket", json("POST", { name: "t/a.txt" }));
    expect(down.status).toBe(200);
    expect(await down.json()).toHaveProperty("ticket");
  });

  it("passes invalid names to the framework", async () => {
    const t = await open({ user: mockUsers.user("files") });
    const body: ErrorBody = await (await t.request("/api/files/head?name=")).json();
    expect(body.error.code).toBe("FILES.INVALID_NAME");
  });
});
