// An offline run of the whole live-pass runner, in one session, through its command line: the real
// runner (scripts/live-pass/live-pass.mjs) against a fake Cloudflare world behind fetch
// (test-support/fake-world.mjs) and a stand-in for the framework CLI (test-support/fake-framework.mjs).
// The test plays the owner: it changes the fake world the way the browser steps would, saves pasted
// values as the session agent does, then answers the runner's prompts. No network.
//
// Written from the owner's requirement (DEC-0793): the owner gives the test Cloudflare account's ID and
// one token; the runner does everything that needs no human Cloudflare login (it invites the tester,
// changes the tester's role and back, rolls the everyday token's value so the owner copies nothing,
// passes each token only to the command that needs it); every human step is one link, one to three
// sentences, and the exact reply; the records end in R2, the same token reads them; no token value is
// printed or recorded; the sandbox's own (primary Cloudflare account's) token and ID are never used.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT, BOOT_GROUPS, harness, PRIMARY_TOKEN, TESTER } from "./test-support/harness.mjs";
import { STEPS, starterTokenLink } from "./lib/steps.mjs";

const RUNBOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ai", "implementation", "live-pass-v0.2.0.md");
/** The runbook's numbered sections: { "3": "After the run: analysis and cleanup", … }. */
const runbookSections = (): Record<string, string> => Object.fromEntries([...readFileSync(RUNBOOK, "utf8").matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => [m[1], m[2]]));

const PART2 = new Set(STEPS.filter((s: { session: number }) => s.session === 2).map((s: { id: string }) => s.id));
const BOOT_STEPS = new Set(["S2", "S4", "S5"]);

describe("the runner's closing text", () => {
  // The agent relays it to the owner word for word; it must send the owner to the runbook's analysis
  // section. Root-cause record: ai/implementation/root-causes/2026-11-08-live-pass-closing-text-section.md
  it("names the runbook section that holds the analysis and the cleanup", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "live-pass.mjs"), "utf8");
    const text = source.slice(source.indexOf("function finishText"), source.indexOf("function writeResults"));
    const refs = [...text.matchAll(/runbook's section (\d+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    const sections = runbookSections();
    for (const n of refs) expect(sections[n], `the closing text names the runbook's section ${n}`).toMatch(/analysis/i);
  });
});

describe("an offline live pass in one session", () => {
  it("needs from the owner only the first message, links with one reply each, and two pasted starter tokens; records no token value", async () => {
    const h = await harness();
    const c = h.container();
    h.firstMessage(c);
    const prompts: string[] = [];
    const ask = (r: { status: number | null; out: string }, step: string) => {
      h.prompt(r, step);
      prompts.push(r.out.slice(r.out.lastIndexOf("=== OWNER STEP")));
      return r;
    };

    // ---- Part 1 ----
    let r = ask(h.run(c, "start", "--primary-login", TESTER), "P3");
    expect(h.world().invitations).toEqual([{ email: TESTER, roles: ["r3"], status: "pending" }]);
    h.owner.acceptInvitation();
    // S1 (a starter token with no expiry) is dropped from this pass (owner decision on #171): the owner is never asked for one.
    r = ask(h.run(c, "answer", "ok"), "TOK-S4");
    const boot = h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600);
    const ids: Record<string, string> = { boot: h.world().tokens.find((t: { value: string }) => t.value === boot).id };
    h.paste(c, "LIVE_PASS_STARTER", boot);
    r = ask(h.run(c, "answer", "saved"), "TOK-S5");
    const rerun = h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600);
    ids.rerun = h.world().tokens.find((t: { value: string }) => t.value === rerun).id;
    h.paste(c, "LIVE_PASS_STARTER_RERUN", rerun);
    r = ask(h.run(c, "answer", "saved"), "S6");
    r = ask(h.run(c, "answer", "ok"), "S6");
    h.owner.adminSignIns();
    r = ask(h.run(c, "answer", "ok"), "S7");
    h.owner.accountSetup();
    r = ask(h.run(c, "answer", "ok"), "E-1");
    r = ask(h.run(c, "answer", "ok"), "S8");
    const shown = h.owner.everydayToken();
    const everydayId = h.world().tokens.find((t: { value: string }) => t.value === shown).id;
    // The owner replies ok and copies nothing: the runner rolls the value; part 1 ends, part 2 runs on.
    r = ask(h.run(c, "answer", "ok"), "S10");
    expect(h.world().rolled).toEqual([everydayId]);
    const rolledFile = join(c.secrets, "CLOUDFLARE_API_TOKEN");
    expect(statSync(rolledFile).mode & 0o777).toBe(0o600);
    const rolled = readFileSync(rolledFile, "utf8").trim();
    expect(rolled).not.toBe(shown);

    // ---- Part 2, in the same session ----
    r = ask(h.run(c, "answer", "ok"), "S13");
    expect(r.out).toContain("Part 2 begins now, in this session.");
    h.owner.ownerSignInAndUpload();
    r = ask(h.run(c, "answer", "ok"), "S13");
    h.owner.testerSignIn("user");
    // The runner changes the primary account login's role itself, with no wait (owner decision on #171, option B).
    r = ask(h.run(c, "answer", "ok"), "S14");
    expect(h.world().roleChanges).toEqual([{ member: "m2", roles: ["Administrator"] }]);
    expect(r.out).not.toContain("(waiting");
    h.owner.testerSignIn("admin");
    r = ask(h.run(c, "answer", "admin"), "S14");
    expect(h.world().roleChanges.at(-1)).toEqual({ member: "m2", roles: ["HTTP Applications Read"] });
    h.owner.testerSignIn("user");
    r = ask(h.run(c, "answer", "user"), "S15");
    r = ask(h.run(c, "answer", "ok"), "S15");
    r = ask(h.run(c, "answer", "ok"), "S16");
    // U1 (the grant and a token it did not create) and E-10 (Clean up v0.1.x email) are not in this pass (DEC-0793).
    r = h.run(c, "answer", "ok");
    expect(r.status, h.transcript.join("\n")).toBe(0);
    expect(r.out).toContain("THE LIVE PASS IS FINISHED");
    expect(r.out).toMatch(/R2 bucket live-pass-records, prefix runs\/lp-[0-9-]+\//);
    expect(r.out).toContain("no new token is needed");
    expect(r.out).toContain(`rm -rf ${c.secrets}`);

    // ---- Every owner prompt: the login whose browser profile it is for, one link, one to three sentences, the exact reply ----
    expect(prompts.length).toBe(16);
    expect(prompts.some((p) => /OWNER STEP (TOK-S1|S1) /.test(p))).toBe(false);
    const forPrimary = prompts.filter((p) => p.includes("===\nIn the primary account login's browser profile:")).map((p) => p.match(/OWNER STEP (\S+) \(part (\d+)/)?.slice(1).join("."));
    expect(forPrimary).toEqual(["P3.1", "S6.2", "S13.2", "S14.1", "S14.2"]);
    for (const p of prompts) {
      const body = p.slice(p.indexOf("===\n") + 4, p.search(/\n\nWhen the owner replies/)).split("\n");
      expect(body[0], p).toMatch(/^In the (test|primary) account login's browser profile:$/);
      expect(body[1], p).toMatch(/^Open: \S/);
      // One link: a URL, except P3's, which is the invitation link in the email Cloudflare sent.
      if (/OWNER STEP P3 /.test(p)) expect(body[1], p).toContain(TESTER);
      else expect(body[1], p).toMatch(/^Open: https:\/\/\S+$/);
      // A starter token is made from the framework's own pre-filled link.
      if (/OWNER STEP TOK-/.test(p)) expect(body[1], p).toBe(`Open: ${starterTokenLink(ACCOUNT)}`);
      expect(body.at(-1), p).toMatch(/^Reply: \S/);
      expect(body.length - 3, p).toBeGreaterThanOrEqual(1);
      expect(body.length - 3, p).toBeLessThanOrEqual(3);
      // The owner's terminology: a login is "the test account login" or "the primary account login", never "the tester", "the owner" or "you".
      const words = body.join("\n").replace(/\S+@\S+/g, "<email>");
      expect(words, p).not.toMatch(/\btester\b|\bthe owner\b|\byour email\b|\byou \(/i);
    }
    // A pasted value goes into a file, never into a command.
    for (const p of prompts.filter((x) => /OWNER STEP TOK-/.test(x))) expect(p).toContain(`Open: https://dash.cloudflare.com/${ACCOUNT}/api-tokens?permissionGroupKeys=`);
    for (const p of prompts.filter((x) => /OWNER STEP TOK-/.test(x))) expect(p).toMatch(/save that value .* as \S+\/LIVE_PASS_STARTER(_RERUN)?, run chmod 600 .* answer saved/s);

    // ---- What the analyst gets ----
    const recordsDir = join(c.workdir, "records", readdirSync(join(c.workdir, "records"))[0]);
    const results = JSON.parse(readFileSync(join(recordsDir, "results.json"), "utf8"));
    const failed = results.steps.filter((s: { result: string }) => !["pass", "info", "n/a"].includes(s.result));
    if (failed.length > 0) {
      const details = failed.map((s: { id: string }) => {
        const f = readdirSync(join(recordsDir, "steps")).filter((n) => n.endsWith(`-${s.id}.json`)).at(-1);
        const rec = f ? JSON.parse(readFileSync(join(recordsDir, "steps", f), "utf8")) : {};
        return `${s.id}: ${JSON.stringify((rec.observations ?? []).filter((o: { pass: unknown }) => o.pass === false), null, 1)}`;
      });
      throw new Error(`steps not passed:\n${details.join("\n")}\n\n${h.transcript.join("\n")}`);
    }
    expect(results.steps.filter((s: { result: string }) => s.result === "n/a").map((s: { id: string }) => s.id)).toEqual([]);
    expect(results.checks.find((x: { id: string }) => x.id === "A-1")?.result).toBe("pass");

    // ---- Each token reaches only the command that needs it; the sandbox's own values never do ----
    const w = h.world();
    expect(w.primaryTokenUsed).toBeUndefined();
    expect(w.frameworkCalls.every((x: { accountIsTest: boolean }) => x.accountIsTest)).toBe(true);
    // By value, under any variable name: each setup gets its own starter token (S2 a non-token), every other
    // framework command the everyday token, and none the owner's token or the sandbox's own.
    type Call = { cmd: string; tokenEnv: Record<string, string> };
    const calls = w.frameworkCalls as Call[];
    expect(calls.filter((x) => x.cmd === "cloudflare-setup").map((x) => x.tokenEnv)).toEqual([{}, { CLOUDFLARE_BOOTSTRAP_TOKEN: ids.boot }, { CLOUDFLARE_BOOTSTRAP_TOKEN: ids.rerun }, { CLOUDFLARE_API_TOKEN: everydayId }]);
    const others = calls.filter((x) => x.cmd !== "cloudflare-setup");
    expect(others.length).toBeGreaterThan(0);
    for (const x of others) expect(x.tokenEnv, x.cmd).toEqual({ CLOUDFLARE_API_TOKEN: everydayId });
    const commands = readdirSync(join(recordsDir, "commands")).map((f) => JSON.parse(readFileSync(join(recordsDir, "commands", f), "utf8")));
    for (const cmd of commands) {
      expect(cmd.env.CLOUDFLARE_BOOTSTRAP_TOKEN, `${cmd.step} ${cmd.label}`).toBe(BOOT_STEPS.has(cmd.step) ? "set" : undefined);
      const fwCmd = String(cmd.argv[0]).endsWith("prototype-framework");
      expect(cmd.env.CLOUDFLARE_API_TOKEN, `${cmd.step} ${cmd.label}`).toBe(PART2.has(cmd.step) && fwCmd ? "set" : undefined);
      expect(cmd.env.CLOUDFLARE_ACCOUNT_ID, `${cmd.step} ${cmd.label}`).toBe("set");
    }

    // ---- No token value anywhere: not printed, not in a record, not in the records bucket ----
    const secrets = { owner: h.tokens.owner, boot, rerun, shown, rolled, primary: PRIMARY_TOKEN };
    const printed = h.printed.join("\n");
    for (const [name, v] of Object.entries(secrets)) expect(printed.includes(v), `the runner printed ${name}`).toBe(false);
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const file of walk(recordsDir)) {
      const text = readFileSync(file, "utf8");
      for (const [name, v] of Object.entries(secrets)) expect(text.includes(v), `${file} holds ${name}`).toBe(false);
    }
    const uploaded = w.buckets["live-pass-records"].objects as Record<string, { body: string }>;
    for (const [key, o] of Object.entries(uploaded)) for (const [name, v] of Object.entries(secrets)) expect(o.body.includes(v), `${key} holds ${name}`).toBe(false);
    const state = JSON.parse(Object.entries(uploaded).find(([k]) => k.endsWith("/state.json"))![1].body);
    expect(state.phase).toBe("finished");
    expect(state.sessions.map((s: { number: number }) => s.number)).toEqual([1, 2]);
    // The runner's probe and stand-in tokens are gone; the owner's, the everyday and the signing token stay.
    expect(w.tokens.map((t: { name: string }) => t.name).sort()).toEqual(["live-pass-owner", "prototype-framework", "prototype-r2-signing"]);
    const handover = JSON.parse(Object.entries(uploaded).find(([k]) => k.endsWith("/handover.json"))![1].body);
    expect(handover).toMatchObject({ bucket: "live-pass-records", token: "live-pass-owner", prefix: state.prefix });

    // ---- The analyst fetches every record with one command and the same owner token ----
    const a = h.container();
    h.firstMessage(a);
    const to = join(a.workdir, "analysis");
    const dl = h.runOnce(a, "download", "--to", to);
    expect(dl.status, h.transcript.join("\n")).toBe(0);
    const runKeys = Object.keys(uploaded).filter((k) => k.startsWith(state.prefix));
    const downloaded = walk(to).map((f) => f.slice(to.length + 1)).sort();
    expect(downloaded).toEqual(runKeys.map((k) => k.slice(state.prefix.length)).sort());
    expect(downloaded).toEqual(expect.arrayContaining(["state.json", "results.md", "handover.json"]));
  }, 600_000);

  it("falls back to a pasted everyday token when Cloudflare refuses the roll", async () => {
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
    h.change((w: Record<string, unknown>) => {
      w.refuseRoll = true;
    });
    const shown = h.owner.everydayToken();
    const r = h.prompt(h.run(c, "answer", "ok"), "S8");
    expect(r.out).toContain("could not replace the everyday token's value");
    expect(r.out).toContain("CLOUDFLARE_API_TOKEN, run chmod 600");
    h.paste(c, "CLOUDFLARE_API_TOKEN", shown);
    h.prompt(h.run(c, "answer", "saved"), "S10");
    const rec = h.records();
    const state = JSON.parse(Object.entries(rec).find(([k]) => k.endsWith("/state.json"))![1]);
    expect(state.done.S8.result).toBe("pass");
    expect(state.done.S1).toBeUndefined();
    expect(state.done.S5).toMatchObject({ result: "n/a" });
    for (const [key, body] of Object.entries(rec)) expect(body.includes(shown), `${key} holds the everyday token`).toBe(false);
    expect(h.printed.join("\n").includes(shown)).toBe(false);
  }, 300_000);

  // Edge case of "a pasted token never reaches a record" (DEC-0793): the agent passes the pasted value to
  // `answer` instead of saving it as the prompt says.
  it("keeps a starter token out of every record and the output when the agent passes it to `answer` instead of saving it", async () => {
    const h = await harness();
    const c = h.container();
    h.firstMessage(c);
    h.prompt(h.run(c, "start", "--primary-login", TESTER), "P3");
    h.owner.acceptInvitation();
    h.prompt(h.run(c, "answer", "ok"), "TOK-S4");
    const boot = h.dashboardToken("prototype-framework-bootstrap", BOOT_GROUPS, 23 * 3600);
    h.run(c, "answer", boot);
    for (const [key, body] of Object.entries(h.records())) expect(body.includes(boot), `${key} holds the pasted starter token`).toBe(false);
    expect(h.printed.join("\n").includes(boot), "the runner printed the pasted starter token").toBe(false);
  }, 120_000);
});
