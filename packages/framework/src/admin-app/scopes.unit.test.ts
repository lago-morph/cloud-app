/** Plan §5.2 / §7: each admin page requests only its own optional scopes through the admin client. */
import { describe, expect, it } from "vitest";
import { ADMIN_OPTIONAL_SCOPES, REQUIRED_SCOPES } from "../provision/cloudflare/oauth-clients.js";
import { grantScope, PAGE_SCOPES, type AdminPageId } from "./scopes.js";

const PAGES = Object.keys(PAGE_SCOPES) as AdminPageId[];

describe("PAGE_SCOPES (PAR-447)", () => {
  it("sign-in asks for no optional scope: identity and membership only", () => {
    expect(PAGE_SCOPES.signin).toEqual([]);
    expect(grantScope("signin")).toBe("openid user-details.read memberships.read");
  });

  it("every page's scopes are optional scopes the admin client offers (oauth-clients.ts)", () => {
    for (const page of PAGES) for (const s of PAGE_SCOPES[page]) expect(ADMIN_OPTIONAL_SCOPES, `${page}: ${s}`).toContain(s);
  });

  it("the everyday-token page asks for token creation and one scope per everyday group, nothing else (§2.1a, §5.2 page 2)", () => {
    expect([...PAGE_SCOPES.everyday].sort()).toEqual(["account-api-tokens.write", "d1.write", "secrets-store.read", "workers-r2.write", "workers-scripts.write"]);
  });

  it("the read-only status page never asks for token creation or Secrets Store writes", () => {
    expect(PAGE_SCOPES.status).not.toContain("account-api-tokens.write");
    expect(PAGE_SCOPES.status).not.toContain("secrets-store.write");
  });

  it("a page's grant asks for openid, the required scopes and exactly its own optional scopes", () => {
    for (const page of PAGES) {
      const asked = grantScope(page).split(" ");
      expect(asked.slice(0, 3)).toEqual(["openid", ...REQUIRED_SCOPES]);
      expect(asked.slice(3)).toEqual([...PAGE_SCOPES[page]]);
      expect(new Set(asked).size).toBe(asked.length);
    }
  });
});
