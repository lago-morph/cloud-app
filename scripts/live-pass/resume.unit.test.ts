// An offline live pass, in one session, in which the cloud container is lost twice: once in part 1
// while the S8 prompt waits, and once in the middle of part 2. A new container has an empty secrets
// directory, so the agent saves the owner's first message again (runbook section 5); the runner rolls
// the everyday token's value again itself. Everything is read back the way the analyst reads it: from
// the records bucket.
//
// Written from the owner's requirements (first by the independent test author on 2026-11-02, after
// PR #166; changed for DEC-0793):
// - the runner executes the commands itself;
// - its values come from a mode-600 secrets directory, never from the sandbox's environment (which
//   holds the primary Cloudflare account's token and ID);
// - a durable checkpoint in the records bucket lets the run resume with
//   `node scripts/live-pass/live-pass.mjs resume`, and the runbook (section 5) says a lost container
//   loses nothing: save the first message again and run `resume`;
// - credential values are never printed, logged or stored;
// - records may hold both people's emails and Cloudflare user IDs;
// - telemetry: every command (args, exit code, timing, scrubbed output), API snapshots after each
//   step, expected against observed per step, Workers Logs, prototype-logs and the auth app's rows;
// - the owner's token reads every record and can delete everything the run created.
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT, BOOT_GROUPS, harness, PRIMARY_ACCOUNT, PRIMARY_TOKEN, TESTER } from "./test-support/harness.mjs";
import { starterTokenLink } from "./lib/steps.mjs";

type Result = { status: number | null; out: string };
type H = Awaited<ReturnType<typeof harness>>;

describe("an offline live pass that loses its container in both parts", () => {
  let h: H;
  const values: Record<string, string> = {};
  let resumeAfterLoss: Result;
  let refusedEmpty: Result;
  let refusedPrimary: Result;
  let refusedLoose: Result;
  let stateBeforeRefusals = "";
  let stateAfterRefusals = "";
  let rolledBefore = 0;
  let rolledAfter = 0;
  let prefix = "";
  let rec: Record<string, string> = {};
  const json = (key: string) => JSON.parse(rec[`${prefix}${key}`] ?? "null");
  const keys = (sub: string) => Object.keys(rec).filter((k) => k.startsWith(`${prefix}${sub}`));
  const jsonl = (key: string) => (rec[`${prefix}${key}`] ?? "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const stateKey = () => Object.keys(h.records()).find((k) => k.endsWith("/state.json")) ?? "";

  beforeAll(async () => {
    h = await harness();
    values.owner = h.tokens.owner;
    // ---- Part 1, container 1 ----
    let c = h.container();
    h.firstMessage(c);
    h.prompt(h.run(c, "start", "--primary-login", TESTER), "P3");
    h.owner.acceptInvitation();
    h.prompt(h.run(c, "answer", "ok"), "TOK-S4");
    h.paste(c, "LIVE_PASS_STARTER", (values.boot = h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600)));
    h.prompt(h.run(c, "answer", "saved"), "TOK-S5");
    h.paste(c, "LIVE_PASS_STARTER_RERUN", (values.rerun = h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600)));
    h.prompt(h.run(c, "answer", "saved"), "S6");
    h.prompt(h.run(c, "answer", "ok"), "S6");
    h.owner.adminSignIns();
    h.prompt(h.run(c, "answer", "ok"), "S7");
    h.owner.accountSetup();
    h.prompt(h.run(c, "answer", "ok"), "E-1");
    h.prompt(h.run(c, "answer", "ok"), "S8");
    values.shown = h.owner.everydayToken();
    const everydayId = h.world().tokens.find((t: { value: string }) => t.value === values.shown).id;

    // ---- The container is lost while S8 waits; the new one has an empty secrets directory ----
    stateBeforeRefusals = h.records()[stateKey()];
    c = h.container();
    refusedEmpty = h.runOnce(c, "resume");
    h.paste(c, "CLOUDFLARE_ACCOUNT_ID", PRIMARY_ACCOUNT);
    h.paste(c, "LIVE_PASS_OWNER_TOKEN", h.tokens.owner);
    refusedPrimary = h.runOnce(c, "resume");
    h.firstMessage(c);
    chmodSync(join(c.secrets, "LIVE_PASS_OWNER_TOKEN"), 0o644);
    refusedLoose = h.runOnce(c, "resume");
    chmodSync(join(c.secrets, "LIVE_PASS_OWNER_TOKEN"), 0o600);
    stateAfterRefusals = h.records()[stateKey()];
    resumeAfterLoss = h.prompt(h.run(c, "resume"), "S8");
    h.prompt(h.run(c, "answer", "ok"), "S10");
    values.rolled2 = readFileSync(join(c.secrets, "CLOUDFLARE_API_TOKEN"), "utf8").trim();
    h.prompt(h.run(c, "answer", "ok"), "S13");
    h.owner.ownerSignInAndUpload();
    h.prompt(h.run(c, "answer", "ok"), "S13");

    // ---- The container is lost again, in the middle of S13 ----
    rolledBefore = (h.world().rolled ?? []).length;
    c = h.container();
    h.firstMessage(c);
    h.prompt(h.run(c, "resume"), "S13");
    h.owner.testerSignIn("user");
    h.prompt(h.run(c, "answer", "ok"), "S14");
    h.prompt(h.run(c, "answer", "user"), "S14");
    h.owner.testerSignIn("admin");
    h.prompt(h.run(c, "answer", "admin"), "S14");
    h.owner.testerSignIn("user");
    h.prompt(h.run(c, "answer", "user"), "S15");
    h.prompt(h.run(c, "answer", "ok"), "S15");
    h.prompt(h.run(c, "answer", "ok"), "S16");
    const r = h.run(c, "answer", "ok"); // U1 and E-10 are not in this pass (DEC-0793)
    if (r.status !== 0 || !r.out.includes("THE LIVE PASS IS FINISHED")) throw new Error(`the run did not finish:\n${h.transcript.join("\n")}`);
    rolledAfter = (h.world().rolled ?? []).length;
    if (existsSync(join(c.secrets, "CLOUDFLARE_API_TOKEN"))) values.rolled3 = readFileSync(join(c.secrets, "CLOUDFLARE_API_TOKEN"), "utf8").trim();
    values.primary = PRIMARY_TOKEN;

    rec = h.records();
    prefix = JSON.parse(rec["latest.json"]).key.replace(/state\.json$/, "");
  }, 600_000);

  it("refuses (exit 3) to resume without the secrets directory's two values, with the primary Cloudflare account's ID, or with a file others can read, and changes nothing", () => {
    expect(refusedEmpty.status).toBe(3);
    expect(refusedEmpty.out).toContain("CLOUDFLARE_ACCOUNT_ID is missing");
    expect(refusedEmpty.out).toContain("LIVE_PASS_OWNER_TOKEN is missing");
    expect(refusedPrimary.status).toBe(3);
    expect(refusedPrimary.out).toContain("primary Cloudflare account's ID");
    expect(refusedLoose.status).toBe(3);
    expect(refusedLoose.out).toContain("can be read by other users");
    expect(stateAfterRefusals).toBe(stateBeforeRefusals);
  });

  it("resumes part 1 in a new container and asks the waiting S8 prompt again", () => {
    expect(resumeAfterLoss.status, resumeAfterLoss.out).toBe(10);
    expect(resumeAfterLoss.out).toContain("OWNER STEP S8 ");
  });

  it("rolls the everyday token's value again in a new container that lost it, and keeps using the same token", () => {
    expect(rolledAfter).toBeGreaterThan(rolledBefore);
    const notes = keys("steps/").map((k) => JSON.parse(rec[k])).flatMap((s) => (s.notes ?? []).map((n: { text: string }) => n.text));
    expect(notes.some((n) => n.includes("rolled it again"))).toBe(true);
    const state = json("state.json");
    expect(h.world().tokens.find((t: { id: string }) => t.id === state.facts.everydayTokenId)?.name).toBe("prototype-framework");
  });

  it("finishes with every step passed or recorded, both parts in the state", () => {
    const results = json("results.json");
    const bad = results.steps.filter((s: { result: string }) => !["pass", "info", "n/a"].includes(s.result));
    expect(bad, h.transcript.join("\n")).toEqual([]);
    const state = json("state.json");
    expect(state.phase).toBe("finished");
    expect(state.sessions.map((s: { number: number }) => s.number)).toEqual([1, 1, 2, 2]);
  });

  it("keeps every container's lines of the append-only logs in the records bucket", () => {
    const starts = jsonl("events.jsonl").filter((e: { event: string }) => e.event === "invocation");
    // Refused invocations stop before anything is recorded.
    expect(starts.length).toBe(h.invocations());
    expect(starts.map((e: { command: string }) => e.command)).toEqual(expect.arrayContaining(["start", "resume", "answer"]));
    const calls = jsonl("api-calls.jsonl");
    const cp = Date.parse(json("state.json").checkpointAt);
    expect(calls.some((c: { at: string }) => Date.parse(c.at) < cp)).toBe(true);
    expect(calls.some((c: { at: string }) => Date.parse(c.at) > cp)).toBe(true);
    const obs = jsonl("observability.jsonl").map((o: { afterStep: string }) => o.afterStep);
    expect(obs).toEqual(expect.arrayContaining(["S4", "S17"]));
    const http = jsonl("http.jsonl").map((x: { step: string }) => x.step);
    expect(http).toEqual(expect.arrayContaining(["P1", "R1"]));
  });

  it("diffs the first snapshot of a new container against the last one of the previous container", () => {
    const s13 = keys("steps/").filter((k) => k.endsWith("-S13.json")).map((k) => JSON.parse(rec[k])).at(-1);
    expect(s13.snapshotDiff.added).not.toContain("worker:prototype-admin");
  });

  it("holds the telemetry the owner asked for: every command, a snapshot after every step, expected against observed, the server side", () => {
    const commands = keys("commands/").map((k) => JSON.parse(rec[k]));
    expect(commands.length).toBeGreaterThan(5);
    for (const c of commands) {
      expect(Array.isArray(c.argv) && c.argv.length > 0).toBe(true);
      expect(c.exitCode === null || Number.isInteger(c.exitCode)).toBe(true);
      expect(Number.isNaN(Date.parse(c.startedAt))).toBe(false);
      expect(Date.parse(c.endedAt)).toBeGreaterThanOrEqual(Date.parse(c.startedAt));
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof c.stdout).toBe("string");
      expect(typeof c.stderr).toBe("string");
      expect(c.rawSecretHits).toEqual({});
    }
    const state = json("state.json");
    const stepFiles = keys("steps/").map((k) => JSON.parse(rec[k]));
    for (const id of Object.keys(state.done)) {
      const r = stepFiles.filter((s) => s.id === id).at(-1);
      expect(r, id).toBeDefined();
      expect(Array.isArray(r.expected), id).toBe(true);
      for (const o of r.observations) expect(o, `${id} ${String(o.id)}`).toHaveProperty("observed");
      expect(rec[`${prefix}${r.snapshot}`], `${id} snapshot ${String(r.snapshot)}`).toBeDefined();
      expect(r.snapshotDiff, id).toHaveProperty("added");
    }
    const wl = json("server/workers-logs-final.json");
    expect(JSON.stringify(wl.events)).toContain("admin signed in");
    expect(json("server/workers-logs-checkpoint.json").count).toBeGreaterThan(0);
    expect(keys("server/log-bucket/livepass/prodcheck/").length).toBe(1);
    const db = json("server/auth-db-final.json");
    expect(db.users.rows).toEqual(expect.arrayContaining([expect.objectContaining({ sub: "u-owner", email: "owner@example.com" }), expect.objectContaining({ sub: "u-tester", email: TESTER })]));
    for (const c of jsonl("api-calls.jsonl")) {
      expect(c).toHaveProperty("method");
      expect(c).toHaveProperty("path");
      expect(c).toHaveProperty("status");
    }
  });

  it("keeps both people's emails and Cloudflare user IDs readable", () => {
    const run = json("run.json");
    expect(run.accountId).toBe(ACCOUNT);
    expect(run.facts.owner).toMatchObject({ email: "owner@example.com", userId: "u-owner" });
    expect(run.facts.tester).toMatchObject({ email: TESTER, userId: "u-tester" });
  });

  it("never prints, logs or stores a token value: not in the runner's output, not in any record, not in the state", () => {
    const printed = h.printed.join("\n");
    for (const [name, v] of Object.entries(values)) expect(printed.includes(v), `the runner printed ${name}`).toBe(false);
    for (const [key, body] of Object.entries(rec)) for (const [name, v] of Object.entries(values)) expect(body.includes(v), `${key} holds ${name}`).toBe(false);
    expect(h.world().primaryTokenUsed).toBeUndefined();
  });

  it("leaves only what the runbook keeps for the analyst, and the owner's token covers deleting all of it", () => {
    const w = h.world();
    expect(Object.keys(w.workers).sort()).toEqual(["prototype-admin", "prototype-auth"]);
    expect(Object.keys(w.buckets).sort()).toEqual(["live-pass-records", "prototype-backups", "prototype-logs", "sst-state"]);
    expect(w.d1.map((d: { name: string }) => d.name)).toEqual(["prototype-auth"]);
    expect(w.tokens.map((t: { name: string }) => t.name).sort()).toEqual(["live-pass-owner", "prototype-framework", "prototype-r2-signing"]);
    // What deletes each kind of resource the final snapshot can hold (live-pass-analysis.md section 4), members included.
    const deleter: Record<string, string> = { workers: "Workers Scripts Write", d1: "D1 Write", r2: "Workers R2 Storage Write", secretsStore: "Secrets Store Write", tokens: "Account API Tokens Write", oauthClients: "OAuth Client Write", members: "Account Settings Write" };
    const handover = json("handover.json");
    expect(handover.token).toBe("live-pass-owner");
    const finalSnap = json(keys("snapshots/").sort().at(-1)!.slice(prefix.length));
    const kinds = Object.keys(finalSnap).filter((k) => Array.isArray(finalSnap[k]?.items) && finalSnap[k].items.length > 0);
    for (const k of kinds) {
      expect(deleter[k], `no known group deletes ${k}`).toBeDefined();
      expect(handover.tokenGroups, k).toContain(deleter[k]);
    }
    // Reading the records needs R2 access.
    expect(handover.tokenGroups).toContain("Workers R2 Storage Write");
  });
});

// The runbook (section 1, "If something goes wrong"): after a lost container the runner continues where it
// stopped, and "a starter token you pasted in the lost container may be asked for again". Here the
// container is lost in the middle of each bootstrap (S4, then S5): the new container's secrets directory
// holds only the owner's first message. Root-cause record:
// ai/implementation/root-causes/2026-11-08-live-pass-lost-starter-token.md
describe("a starter token pasted in a container that is lost during its bootstrap", () => {
  let h: H;
  type Call = { cmd: string; tokens: string[] };
  let tokenlessSetups: Call[] = [];
  let afterS4Loss: Result;
  let recovered: Result;
  let afterS5Loss: Result;
  let state: { done: Record<string, { result: string; reason?: string }> } = { done: {} };

  beforeAll(async () => {
    h = await harness();
    let c = h.container();
    h.firstMessage(c);
    h.prompt(h.run(c, "start", "--primary-login", TESTER), "P3");
    h.owner.acceptInvitation();
    h.prompt(h.run(c, "answer", "ok"), "TOK-S4");
    h.paste(c, "LIVE_PASS_STARTER", h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600));
    h.change((w: Record<string, unknown>) => {
      w.loseContainerOnBootstrap = true;
    });
    h.runOnce(c, "answer", "saved"); // the runner dies in the middle of S4's bootstrap
    const before = h.world().frameworkCalls.length;
    c = h.container();
    h.firstMessage(c);
    afterS4Loss = h.runOnce(c, "resume");
    tokenlessSetups = (h.world().frameworkCalls as Call[]).slice(before).filter((x) => x.cmd === "cloudflare-setup" && x.tokens.length === 0);
    // The owner makes a new starter token from the link; the agent saves it and goes on as the runner says.
    h.paste(c, "LIVE_PASS_STARTER", h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600));
    recovered = h.run(c, afterS4Loss.status === 10 ? "answer" : "retry", ...(afterS4Loss.status === 10 ? ["saved"] : []));
    if (recovered.status !== 10 || !recovered.out.includes("OWNER STEP TOK-S5 ")) return;
    h.paste(c, "LIVE_PASS_STARTER_RERUN", h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600));
    h.change((w: Record<string, unknown>) => {
      w.loseContainerOnBootstrap = true;
    });
    h.runOnce(c, "answer", "saved"); // the runner dies in the middle of S5's bootstrap
    c = h.container();
    h.firstMessage(c);
    afterS5Loss = h.run(c, "resume");
    state = JSON.parse(Object.entries(h.records()).find(([k]) => k.endsWith("/state.json"))![1]);
  }, 300_000);

  it("does not run the bootstrap without a starter token", () => {
    expect(tokenlessSetups, h.transcript.join("\n")).toEqual([]);
  });

  it("asks for the S4 starter token again: the framework's link and the file to save it as", () => {
    expect([1, 10], afterS4Loss.out).toContain(afterS4Loss.status);
    expect(afterS4Loss.out).toContain(starterTokenLink(ACCOUNT));
    expect(afterS4Loss.out).toMatch(/\/LIVE_PASS_STARTER(?!_)\b/);
  });

  it("goes on with the new starter token: S4 passes and TOK-S5 is asked", () => {
    expect(recovered.status, h.transcript.join("\n")).toBe(10);
    expect(recovered.out).toContain("OWNER STEP TOK-S5 ");
  });

  it("does not record S5 as skipped by the owner when the owner pasted its token", () => {
    expect(afterS5Loss, h.transcript.join("\n")).toBeDefined();
    expect(state.done.S5?.reason ?? "", JSON.stringify(state.done.S5)).not.toMatch(/skipped/i);
  });
});

describe("S14 skipped partway, after the runner changed the role", () => {
  it("sets the primary account login's role back and records it", async () => {
    const h = await harness();
    const c = h.container();
    h.firstMessage(c);
    h.prompt(h.run(c, "start", "--primary-login", TESTER), "P3");
    h.owner.acceptInvitation();
    h.prompt(h.run(c, "answer", "ok"), "TOK-S4");
    h.paste(c, "LIVE_PASS_STARTER", h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600));
    h.prompt(h.run(c, "answer", "saved"), "TOK-S5");
    h.prompt(h.run(c, "answer", "skip"), "S6");
    h.prompt(h.run(c, "answer", "ok"), "S6");
    h.owner.adminSignIns();
    h.prompt(h.run(c, "answer", "ok"), "S7");
    h.owner.accountSetup();
    h.prompt(h.run(c, "answer", "ok"), "E-1");
    h.prompt(h.run(c, "answer", "ok"), "S8");
    h.owner.everydayToken();
    h.prompt(h.run(c, "answer", "ok"), "S10");
    h.prompt(h.run(c, "answer", "ok"), "S13");
    h.owner.ownerSignInAndUpload();
    h.prompt(h.run(c, "answer", "ok"), "S13");
    h.owner.testerSignIn("user");
    h.prompt(h.run(c, "answer", "ok"), "S14");
    expect(h.world().roleChanges).toEqual([{ member: "m2", roles: ["Administrator"] }]);
    h.prompt(h.run(c, "skip", "S14", "the owner stopped S14 here"), "S15");
    expect(h.world().roleChanges.at(-1)).toEqual({ member: "m2", roles: ["HTTP Applications Read"] });
    expect(h.world().members.find((m: { id: string }) => m.id === "m2").roles.map((r: { name: string }) => r.name)).toEqual(["HTTP Applications Read"]);
    const rec = h.records();
    const s14 = Object.entries(rec).filter(([k]) => /\/steps\/\d+-S14\.json$/.test(k)).map(([, b]) => JSON.parse(b)).at(-1);
    expect(s14.result).toBe("skipped");
    expect(s14.observations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "role set back", pass: true })]));
  }, 300_000);
});

describe("the durable state in the records bucket", () => {
  it("holds no credential value, even when an owner's skip reason contains one", async () => {
    const h = await harness();
    const c = h.container();
    h.firstMessage(c);
    let r = h.run(c, "start", "--primary-login", TESTER);
    expect(r.status, h.transcript.join("\n")).toBe(10);
    r = h.run(c, "skip", "S2", `the owner pasted ${h.tokens.owner} by mistake`);
    expect(r.status, h.transcript.join("\n")).toBe(10);
    const rec = h.records();
    const state = Object.entries(rec).find(([k]) => k.endsWith("/state.json"))![1];
    expect(JSON.parse(state).done.S2).toMatchObject({ result: "skipped" });
    for (const [key, body] of Object.entries(rec)) expect(body.includes(h.tokens.owner), `${key} holds the owner's token`).toBe(false);
    expect(h.printed.join("\n").includes(h.tokens.owner), "the runner printed the owner's token").toBe(false);
  }, 120_000);

  it("refuses to start without the primary account login's email", async () => {
    const h = await harness();
    const c = h.container();
    h.firstMessage(c);
    const r = h.runOnce(c, "start");
    expect(r.status).toBe(2);
    expect(r.out).toContain("--primary-login <email>");
    expect(h.records()).toEqual({});
  }, 60_000);
});
