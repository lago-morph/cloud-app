import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("compliance command options", () => {
  it("needs a target and defaults to the automated tier", () => {
    expect(parseArgs(["--target", "local"])).toEqual({ target: "local", milestone: false, blocked: new Map(), selfTest: false });
    expect(() => parseArgs([])).toThrow(/--target <local\|cloudflare\|aws> is required/);
    expect(() => parseArgs(["--target", "gcp"])).toThrow(/--target/);
  });

  it("reads --stage, --milestone, --base-url, --only and --out", () => {
    expect(parseArgs(["--target=cloudflare", "--stage", "test-abc", "--milestone", "--base-url", "https://x", "--only", "KV-AC-001,E2E-004", "--out", "/tmp/o"])).toEqual({
      target: "cloudflare",
      stage: "test-abc",
      milestone: true,
      baseUrl: "https://x",
      only: ["KV-AC-001", "E2E-004"],
      out: "/tmp/o",
      blocked: new Map(),
      selfTest: false,
    });
  });

  it("refuses a cloud stage that is not a test stage, and a stage on local", () => {
    expect(() => parseArgs(["--target", "cloudflare", "--stage", "prod"])).toThrow(/test-/);
    expect(() => parseArgs(["--target", "local", "--stage", "test-a"])).toThrow(/--stage/);
  });

  it("collects --blocked ID[,ID]=detail, repeatable", () => {
    const parsed = parseArgs(["--target", "cloudflare", "--blocked", "KV-AC-001,SQL-AC-003=D1 unavailable: daily row limit exhausted", "--blocked", "FILES-AC-005=R2 token missing"]);
    expect([...parsed.blocked]).toEqual([
      ["KV-AC-001", "D1 unavailable: daily row limit exhausted"],
      ["SQL-AC-003", "D1 unavailable: daily row limit exhausted"],
      ["FILES-AC-005", "R2 token missing"],
    ]);
    expect([...parseArgs(["--target", "cloudflare", "--blocked", "*=D1 unavailable"]).blocked]).toEqual([["*", "D1 unavailable"]]);
    expect(() => parseArgs(["--target", "local", "--blocked", "KV-AC-001"])).toThrow(/--blocked/);
    expect(() => parseArgs(["--target", "local", "--blocked", "kv=x"])).toThrow(/not a criterion/);
  });

  it("refuses unknown options and IDs of the wrong form", () => {
    expect(() => parseArgs(["--target", "local", "--fast"])).toThrow(/unknown option --fast/);
    expect(() => parseArgs(["--target", "local", "--only", "KV-1"])).toThrow(/not a criterion/);
  });

  it("--self-test needs no target", () => {
    expect(parseArgs(["--self-test"])).toMatchObject({ target: "local", selfTest: true });
  });
});
