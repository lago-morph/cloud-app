/** The admin pages the Worker serves (plan §5.2), each with its own PAR-447 scopes. */
import { describe, expect, it } from "vitest";
import { ADMIN_PAGES } from "./pages.js";
import { PAGE_SCOPES } from "./scopes.js";

describe("ADMIN_PAGES", () => {
  it("lists the pages built so far, once each, every one with a PAR-447 row", () => {
    const ids = ADMIN_PAGES.map((p) => p.id);
    expect(ids).toEqual(["everyday"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Object.keys(PAGE_SCOPES)).toContain(id);
  });
});
