import { describe, expect, it } from "vitest";
import prod from "../config/cloudflare/prod.json";

/**
 * DEC-0521, DEC-0522 (CFG-REQ-005): configuration holds no admin or users list. DEMO-REQ-011
 * ("only listed people can post") is retired: every signed-up user can post, and admins hold the
 * `admin` role in the stage's database (`npm run admins -- grant <email> ...`).
 */
describe("production values files", () => {
  it("config/cloudflare/prod.json has no admins or users list", () => {
    expect(Object.keys(prod.framework).sort()).toEqual(["email"]);
  });
});
