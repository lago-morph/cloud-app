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

describe("setup-account --target aws [--region <r>] (G-11; PROV-REQ-006)", () => {
  function regional(fake: FakeTarget) {
    const seen: { target: string; region?: string }[] = [];
    const deps: SetupAccountDeps = { env: {}, operations: (input) => (seen.push({ target: input.target, ...(input.region === undefined ? {} : { region: input.region }) }), fake) };
    return { deps, seen };
  }
  const AWS_SHARED = { "S3 bucket prototype-logs-123456789012 (eu-west-1)": "absent", "shared network prototype-shared (eu-west-1)": "absent", "SST state home (eu-west-1)": "owned" } as const;

  it("passes the chosen region to the AWS operations and creates the absent shared resources", async () => {
    const fake = new FakeTarget({ sharedResources: { ...AWS_SHARED } });
    const { deps, seen } = regional(fake);
    const io = captureIo();
    expect(await setupAccountCommand(deps)(["--target", "aws", "--region", "eu-west-1"], io)).toBe(0);
    expect(seen).toEqual([{ target: "aws", region: "eu-west-1" }]);
    expect(io.out).toContain("created: S3 bucket prototype-logs-123456789012 (eu-west-1), shared network prototype-shared (eu-west-1)");
    expect(io.out).toContain("already present: SST state home (eu-west-1)");
  });

  it("without --region no region is passed (a new account gets PAR-060, an existing one keeps its own)", async () => {
    const { deps, seen } = regional(new FakeTarget());
    expect(await setupAccountCommand(deps)(["--target=aws"], captureIo())).toBe(0);
    expect(seen).toEqual([{ target: "aws" }]);
  });

  it("a region the account operations refuse (not the log bucket's) exits 1 naming it", async () => {
    const fake = new FakeTarget();
    fake.fail("inspectAccount", new Error("the account's region is us-east-1 (the location of S3 bucket prototype-logs-123456789012); setup-account cannot move it to eu-west-1"));
    const io = captureIo();
    expect(await setupAccountCommand(regional(fake).deps)(["--target", "aws", "--region", "eu-west-1"], io)).toBe(1);
    expect(io.err).toContain("cannot move it to eu-west-1");
  });

  it("--region is a usage error for other targets and for a malformed name, before any operations are built", async () => {
    const { deps, seen } = regional(new FakeTarget());
    await expect(setupAccountCommand(deps)(["--target", "cloudflare", "--region", "eu-west-1"], captureIo())).rejects.toThrow(/--region is only for --target aws/);
    await expect(setupAccountCommand(deps)(["--target", "local", "--region", "eu-west-1"], captureIo())).rejects.toThrow(/--region is only for --target aws/);
    await expect(setupAccountCommand(deps)(["--target", "aws", "--region", "Mars"], captureIo())).rejects.toThrow(/AWS region name such as us-east-1/);
    await expect(setupAccountCommand(deps)(["--target", "aws", "--region"], captureIo())).rejects.toThrow(/--region needs a value/);
    expect(seen).toEqual([]);
  });

  // DEC-0507: the Pluralsight sandbox allows us-east-1 and us-west-2 only; the guard applies only while PROTOTYPE_AWS_SANDBOX=pluralsight.
  it("with PROTOTYPE_AWS_SANDBOX=pluralsight, refuses any --region but us-east-1 and us-west-2, before any operations are built", async () => {
    const fake = new FakeTarget();
    const seen: string[] = [];
    const deps: SetupAccountDeps = { env: { PROTOTYPE_AWS_SANDBOX: "pluralsight" }, operations: (input) => (seen.push(input.region ?? "none"), fake) };
    await expect(setupAccountCommand(deps)(["--target", "aws", "--region", "eu-west-1"], captureIo())).rejects.toThrow(/region eu-west-1 is not allowed .*PROTOTYPE_AWS_SANDBOX=pluralsight.*us-east-1, us-west-2/);
    await expect(setupAccountCommand(deps)(["--target", "aws", "--region", "us-east-2"], captureIo())).rejects.toThrow(UsageError);
    expect(seen).toEqual([]);
    for (const region of ["us-east-1", "us-west-2"]) expect(await setupAccountCommand(deps)(["--target", "aws", "--region", region], captureIo())).toBe(0);
    expect(await setupAccountCommand(deps)(["--target", "aws"], captureIo())).toBe(0);
    expect(seen).toEqual(["us-east-1", "us-west-2", "none"]);
    const typo: SetupAccountDeps = { ...deps, env: { PROTOTYPE_AWS_SANDBOX: "pluralsite" } };
    await expect(setupAccountCommand(typo)(["--target", "aws", "--region", "us-east-1"], captureIo())).rejects.toThrow(/PROTOTYPE_AWS_SANDBOX=pluralsite is not a known sandbox \(known: pluralsight\)/);
  });

  it("accepts region names of every shape (us-east-1, ap-southeast-2, us-gov-west-1)", async () => {
    const { deps, seen } = regional(new FakeTarget());
    for (const region of ["us-east-1", "ap-southeast-2", "us-gov-west-1", "eu-central-2"]) expect(await setupAccountCommand(deps)(["--target", "aws", "--region", region], captureIo())).toBe(0);
    expect(seen.map((s) => s.region)).toEqual(["us-east-1", "ap-southeast-2", "us-gov-west-1", "eu-central-2"]);
  });
});
