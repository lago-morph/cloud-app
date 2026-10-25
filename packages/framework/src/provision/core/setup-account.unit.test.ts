import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { FakeTarget } from "./fake-target.js";
import { runSetupAccount } from "./setup-account.js";

describe("setup-account core (PROV-REQ-004)", () => {
  it("creates the absent shared resources and reports them", async () => {
    const t = new FakeTarget({ sharedResources: { "log bucket": "absent", "state home": "owned" } });
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 0, created: ["log bucket"] });
    expect(t.shared.get("log bucket")).toBe("owned");
    expect(io.out).toMatch(/created: log bucket/);
    expect(io.out).toMatch(/already present: state home/);
  });

  it("a second run changes nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "log bucket": "absent", "state home": "absent" } });
    await runSetupAccount(t, captureIo());
    const before = t.calls.length;
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 0, created: [] });
    expect(t.calls.slice(before)).toEqual(["inspectAccount", "readAccountSettings", "emailSetupProblems example.test", "setUpEmail example.test"]);
    expect(io.out).toMatch(/nothing changed/);
  });

  it("[PROV-AC-004] (core part) --email-domain is required while the record has none; nothing is changed without it", async () => {
    const t = new FakeTarget({ sharedResources: { "log bucket": "absent" }, accountSettings: {} });
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 1, created: [] });
    expect(io.err).toContain("the account settings record names no email domain; run setup-account --target fake --email-domain <domain>");
    expect(t.calls).toEqual(["inspectAccount", "readAccountSettings"]);
    expect(t.shared.get("log bucket")).toBe("absent");
  });

  it("records the domain after creating the shared resources, then sets up its email; a second run with or without the option changes nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "state home": "absent" }, accountSettings: {} });
    t.emailToCreate = ["sending entry", "mail sink"];
    const io = captureIo();
    expect(await runSetupAccount(t, io, { emailDomain: "example.test" })).toEqual({
      status: 0,
      created: ["state home", "sending entry", "mail sink"],
      recorded: "example.test",
    });
    expect(t.calls).toEqual(["inspectAccount", "readAccountSettings", "emailSetupProblems example.test", "createSharedResources state home", "writeAccountSettings example.test", "setUpEmail example.test"]);
    expect(t.accountSettings).toEqual({ emailDomain: "example.test" });
    expect(io.out).toContain("recorded the account's email domain: example.test");
    for (const request of [{}, { emailDomain: "example.test" }]) {
      const again = captureIo();
      expect(await runSetupAccount(t, again, request)).toEqual({ status: 0, created: [] });
      expect(again.out).toMatch(/nothing changed/);
    }
    expect(t.calls.filter((c) => c.startsWith("writeAccountSettings"))).toHaveLength(1);
  });

  it("another --email-domain changes the record and sets up the new domain, leaving the old one's setup", async () => {
    const t = new FakeTarget();
    const io = captureIo();
    expect(await runSetupAccount(t, io, { emailDomain: "other.test" })).toEqual({ status: 0, created: [], recorded: "other.test" });
    expect(t.accountSettings).toEqual({ emailDomain: "other.test" });
    expect(t.calls).toContain("setUpEmail other.test");
    expect(io.out).toContain("the previous email domain example.test keeps its email setup");
  });

  it("an invalid --email-domain is refused before the target is asked anything", async () => {
    for (const domain of ["example", "-a.test", "a..test", "a_b.test", "exa mple.test", "1.2.3.4", `${"a".repeat(64)}.test`, "Example.test"]) {
      const t = new FakeTarget();
      const io = captureIo();
      expect((await runSetupAccount(t, io, { emailDomain: domain })).status, domain).toBe(1);
      expect(io.err).toContain("--email-domain");
      expect(t.calls).toEqual([]);
    }
  });

  it("[PROV-AC-007] (core part) a shared resource owned by another account stops setup-account with a message naming it and changes nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "foreign", "state home": "absent" } });
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 1, created: [] });
    expect(t.calls).toEqual(["inspectAccount"]);
    expect(t.shared.get("state home")).toBe("absent");
    expect(t.calls.some((c) => c.startsWith("writeAccountSettings"))).toBe(false);
    expect(io.err).toMatch(/R2 bucket prototype-logs/);
    expect(io.err).toMatch(/another account/);
  });

  it("[CLI-AC-003] a failing inspection or creation exits non-zero with the target's message", async () => {
    const t = new FakeTarget({ sharedResources: { "log bucket": "absent" } }).fail("createSharedResources", new Error("quota exceeded"));
    const io = captureIo();
    expect((await runSetupAccount(t, io)).status).toBe(1);
    expect(io.err).toMatch(/quota exceeded/);
    const u = new FakeTarget().fail("inspectAccount", new Error("no credentials"));
    expect((await runSetupAccount(u, captureIo())).status).toBe(1);
  });
});
