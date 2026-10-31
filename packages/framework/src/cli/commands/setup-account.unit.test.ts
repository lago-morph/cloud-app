import { describe, expect, it } from "vitest";
import { FakeTarget } from "../../provision/core/fake-target.js";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { setupAccountCommand, type SetupAccountDeps } from "./setup-account.js";

function harness(fake: FakeTarget, env: Record<string, string> = {}) {
  const events: string[] = [];
  const deps: SetupAccountDeps = { env, operations: (input) => (events.push(`operations ${input.target}`), fake) };
  return { deps, events };
}

describe("setup-account (CLI-REQ-001, PROV-REQ-004)", () => {
  it("[PROV-AC-004] creates the absent shared resources, and a second run changes nothing", async () => {
    const fake = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "absent", "R2 bucket sst-state": "owned" } });
    const { deps } = harness(fake);
    const first = captureIo();
    expect(await setupAccountCommand(deps)(["--target", "cloudflare"], first)).toBe(0);
    expect(first.out).toContain("created: R2 bucket prototype-logs");
    const second = captureIo();
    expect(await setupAccountCommand(deps)(["--target", "cloudflare"], second)).toBe(0);
    expect(second.out).toContain("nothing changed");
    expect(fake.calls.filter((c) => c.startsWith("createSharedResources"))).toEqual(["createSharedResources R2 bucket prototype-logs"]);
  });

  it("[PROV-AC-007] a foreign shared resource exits 1 naming it, and nothing is created", async () => {
    const fake = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "foreign", "R2 bucket sst-state": "absent" } });
    const io = captureIo();
    expect(await setupAccountCommand(harness(fake).deps)(["--target", "cloudflare"], io)).toBe(1);
    expect(io.err).toContain("R2 bucket prototype-logs");
    expect(fake.calls.some((c) => c.startsWith("createSharedResources"))).toBe(false);
  });

  it("[PROV-AC-004] needs no email domain: an account without one is set up (v0.2.0, DEC-0698)", async () => {
    const fake = new FakeTarget();
    const io = captureIo();
    expect(await setupAccountCommand(harness(fake).deps)(["--target", "cloudflare"], io)).toBe(0);
    expect(io.err).toBe("");
  });

  it("takes no --email-domain any more (v0.2.0, DEC-0698): it is a usage error, for every target", async () => {
    const h = harness(new FakeTarget());
    for (const target of ["cloudflare", "local"]) {
      await expect(setupAccountCommand(h.deps)(["--target", target, "--email-domain", "example.test"], captureIo())).rejects.toThrow(UsageError);
    }
    expect(h.events).toEqual([]);
  });

  it("target local has no shared resources: it says so, exits 0 and touches no target", async () => {
    const h = harness(new FakeTarget());
    const io = captureIo();
    expect(await setupAccountCommand(h.deps)(["--target", "local"], io)).toBe(0);
    expect(io.out).toMatch(/nothing to set up/);
    expect(h.events).toEqual([]);
  });

  it("accepts only --target (no stage: the resources belong to the account)", async () => {
    const h = harness(new FakeTarget());
    await expect(setupAccountCommand(h.deps)(["--target", "cloudflare", "--stage", "test-x"], captureIo())).rejects.toThrow(UsageError);
    await expect(setupAccountCommand(h.deps)([], captureIo())).rejects.toThrow(/--target is missing/);
    expect(h.events).toEqual([]);
  });

  it("stops with status 1 when the process cannot use the proxy", async () => {
    const fake = new FakeTarget();
    const io = captureIo();
    expect(await setupAccountCommand(harness(fake, { HTTPS_PROXY: "http://p:1" }).deps)(["--target", "cloudflare"], io)).toBe(1);
    expect(io.err).toContain("NODE_USE_ENV_PROXY=1");
    expect(fake.calls).toEqual([]);
  });
});
