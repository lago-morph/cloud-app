// Unit tests for the owner prompts of every step (scripts/live-pass/lib/steps.mjs). Written from the
// owner's rules (DEC-0793): every human prompt names the login whose browser profile it is for, and a
// prompt that makes a token gives one dashboard link for the test Cloudflare account that pre-fills the
// token's name and every permission group it needs, so nobody reads a permission list and clicks it
// together by hand; what the link cannot fill in (the end date) is said in one line.
import { describe, expect, it } from "vitest";
import { formatPrompt } from "./lib/engine.mjs";
import { OWNER_GROUP_IDS } from "./lib/groups.mjs";
import { STEPS } from "./lib/steps.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const STARTER_GROUPS = ["Account API Tokens Write", "OAuth Client Write", "Secrets Store Write", "Workers Scripts Write"];

const ctx = {
  state: { accountId: ACCOUNT, appName: "livepass" },
  facts: { adminUrl: "https://prototype-admin.sub.workers.dev", appUrl: "https://livepass-prodcheck.sub.workers.dev", testerEmail: "p@example.com", owner: { email: "t@example.com" }, tester: { email: "p@example.com", roles: ["HTTP Applications Read"] }, roleChangedAt: new Date().toISOString(), everydayTokenId: "e1" },
  vault: { dir: "/s" },
};
type Part = { prompt: (c: typeof ctx) => unknown; saveAs?: string };
const parts = STEPS.flatMap((s: { id: string; owner?: Part[] }) => (s.owner ?? []).map((p, i) => ({ step: s.id, part: i + 1, p })));
const tokenParts = parts.filter((x) => x.p.saveAs?.startsWith("LIVE_PASS_STARTER"));

describe("every owner prompt", () => {
  it("starts by naming the login whose browser profile it is for", () => {
    expect(parts.length).toBeGreaterThan(10);
    for (const { step, part, p } of parts) {
      const first = formatPrompt(p.prompt(ctx)).split("\n")[0];
      expect(first, `${step} part ${part}`).toMatch(/^In the (test|primary) account login's browser profile:$/);
    }
  });
});

describe("every token prompt", () => {
  it("covers both starter tokens, TOK-S4 and TOK-S5, and nothing asks for S1's token or runs E-10", () => {
    expect(tokenParts.map((x) => x.step)).toEqual(["TOK-S4", "TOK-S5"]);
    expect(STEPS.map((s: { id: string }) => s.id)).not.toEqual(expect.arrayContaining(["S1"]));
    expect(STEPS.map((s: { id: string }) => s.id)).not.toContain("TOK-S1");
    expect(STEPS.map((s: { id: string }) => s.id)).not.toContain("E-10");
  });

  it("links to the test Cloudflare account's token page with the token's name and exactly its required groups", () => {
    for (const { step, p } of tokenParts) {
      const prompt = p.prompt(ctx) as { link: string; text: string[] };
      const url = new URL(prompt.link);
      expect(`${url.origin}${url.pathname}`, step).toBe(`https://dash.cloudflare.com/${ACCOUNT}/api-tokens`);
      expect(url.searchParams.get("name"), step).toBe("prototype-framework-bootstrap");
      const keys = JSON.parse(url.searchParams.get("permissionGroupKeys") ?? "[]");
      expect(keys.map((k: { key: string }) => k.key).sort(), step).toEqual(STARTER_GROUPS.map((g) => OWNER_GROUP_IDS[g]).sort());
      for (const k of keys) expect(k.type, step).toBe("edit");
    }
  });

  it("says in one line the one thing the link cannot set, and never asks to pick groups or the account by hand", () => {
    for (const { step, p } of tokenParts) {
      const prompt = p.prompt(ctx) as { text: string[] };
      const text = prompt.text.join("\n");
      expect(text.split("\n").filter((l) => /end date/i.test(l)), step).toHaveLength(1);
      expect(text, step).not.toMatch(/Account Resources|add (it|them|any) by hand|permission list/i);
    }
  });
});
