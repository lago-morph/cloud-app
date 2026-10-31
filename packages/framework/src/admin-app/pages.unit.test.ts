/** The admin pages the Worker serves (plan §5.2), each with its own PAR-447 scopes. */
import { describe, expect, it } from "vitest";
import { ADMIN_PAGES } from "./pages.js";
import { PAGE_SCOPES } from "./scopes.js";

describe("ADMIN_PAGES", () => {
  it("lists the pages built so far, once each, every one with a PAR-447 row", () => {
    const ids = ADMIN_PAGES.map((p) => p.id);
    expect(ids).toEqual(["setup", "everyday", "status"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Object.keys(PAGE_SCOPES)).toContain(id);
  });

  it("outside the bundle (no compiled-in auth app) account setup says so instead of uploading anything", async () => {
    const setup = ADMIN_PAGES.find((p) => p.id === "setup")!;
    const calls: string[] = [];
    const api = (m: string, p: string) => (calls.push(`${m} ${p}`), Promise.resolve({ status: 200, body: { success: true, result: { subdomain: "s" } } }));
    await expect(setup.run({ admin: { sub: "s", email: "e" }, accountId: "a", api, granted: [], log: () => {}, now: Date.now })).rejects.toThrow("built without the auth app");
    expect(calls.filter((c) => !c.startsWith("GET "))).toEqual([]);
  });
});
