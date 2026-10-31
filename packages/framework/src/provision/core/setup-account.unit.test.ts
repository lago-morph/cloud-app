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
    expect(t.calls.slice(before)).toEqual(["inspectAccount", "setupProblems", "recordSetup"]);
    expect(io.out).toMatch(/nothing changed/);
  });

  it("[PROV-AC-004] (core part) a missing prerequisite is named and nothing is changed", async () => {
    const t = new FakeTarget({ sharedResources: { "log bucket": "absent" } });
    t.missingSetup = ['the credentials lack "Account API Tokens Write"'];
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 1, created: [] });
    expect(io.err).toContain('the credentials lack "Account API Tokens Write"; nothing was changed');
    expect(t.calls).toEqual(["inspectAccount", "setupProblems"]);
    expect(t.shared.get("log bucket")).toBe("absent");
  });

  it("records the setup after creating the shared resources, with no email domain (v0.2.0); a second run changes nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "state home": "absent" }, accountSettings: {} });
    t.recordToWrite = ["account setup record (setup version 2)"];
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 0, created: ["state home", "account setup record (setup version 2)"] });
    expect(t.calls).toEqual(["inspectAccount", "setupProblems", "createSharedResources state home", "recordSetup"]);
    expect(t.accountSettings).toEqual({});
    expect(io.out).toContain("recorded: account setup record (setup version 2)");
    const again = captureIo();
    expect(await runSetupAccount(t, again)).toEqual({ status: 0, created: [] });
    expect(again.out).toMatch(/nothing changed/);
  });

  it("leaves an email domain a 0.1.x setup recorded as it is", async () => {
    const t = new FakeTarget();
    expect(await runSetupAccount(t, captureIo())).toEqual({ status: 0, created: [] });
    expect(t.accountSettings).toEqual({ emailDomain: "example.test" });
  });

  it("[PROV-AC-007] (core part) a shared resource owned by another account stops setup-account with a message naming it and changes nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "foreign", "state home": "absent" } });
    const io = captureIo();
    expect(await runSetupAccount(t, io)).toEqual({ status: 1, created: [] });
    expect(t.calls).toEqual(["inspectAccount"]);
    expect(t.shared.get("state home")).toBe("absent");
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
