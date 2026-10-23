import { describe, expect, it } from "vitest";
import prod from "../config/cloudflare/prod.json";

/** DEMO-AC-011: every committed production values file of the demo sets `framework.users`. */
describe("production values files (DEMO-REQ-011)", () => {
  it("config/cloudflare/prod.json sets framework.users", () => {
    expect(Array.isArray(prod.framework.users)).toBe(true);
  });
});
