// Unit tests for the live-pass step engine (scripts/live-pass/lib/engine.mjs). Written from the
// brief: the runner executes commands itself; for a browser step it asks the owner for one short
// confirmation, then verifies what it can; every step records expected against observed; the run
// is resumable from the stored state at any point (a reclaimed container loses nothing).
import { describe, expect, it } from "vitest";
import { memoryStore, newRun, saveState, loadState } from "./lib/checkpoint.mjs";
import { checkResults, createEngine, stepResult } from "./lib/engine.mjs";

type Obs = { pass?: boolean | null };
type Ctx = { observe: (id: string, o: Record<string, unknown>) => void; facts: Record<string, unknown>; setFacts: (f: Record<string, unknown>) => void; na: (why: string) => void };

const T0 = Date.parse("2026-11-03T10:00:00.000Z");

function harness(catalogue: unknown[], store = memoryStore(), initial = newRun({ runId: "r1", accountId: "a", version: "v", appName: "app", bucket: "b", runnerSha: "s", now: new Date(T0).toISOString() })) {
  const holder = { state: initial };
  const printed: string[] = [];
  const records: Record<string, unknown>[] = [];
  const after: string[] = [];
  let clock = T0;
  const engine = createEngine({
    catalogue,
    holder,
    save: async (s: unknown) => saveState(store, s),
    afterStep: async (_ctx: unknown, step: { id: string }) => {
      after.push(step.id);
    },
    writeStepRecord: (r: Record<string, unknown>) => records.push(r),
    print: (t: string) => printed.push(t),
    now: () => (clock += 1000),
  });
  return { engine, holder, printed, records, after, store, tick: (ms: number) => (clock += ms) };
}

const auto = (id: string, session = 1, fn?: (ctx: Ctx) => void | Promise<void>) => ({
  id,
  session,
  title: `step ${id}`,
  expected: [`${id} works`],
  run: fn ?? ((ctx: Ctx) => ctx.observe(id, { expected: "x", observed: "x", pass: true })),
});

describe("stepResult", () => {
  it("is fail when any observation failed, pass when one passed and none failed, else n/a or info", () => {
    expect(stepResult([{ pass: true }, { pass: false }] as Obs[], false)).toBe("fail");
    expect(stepResult([{ pass: true }, { pass: null }] as Obs[], false)).toBe("pass");
    expect(stepResult([{ pass: null }] as Obs[], true)).toBe("n/a");
    expect(stepResult([], false)).toBe("info");
  });
});

describe("automated steps", () => {
  it("run in order, each recorded with its observations, followed by the after-step hook", async () => {
    const h = harness([auto("A"), auto("B"), { ...auto("CP"), checkpoint: true }]);
    expect(await h.engine.advance(60_000)).toBe("session-done");
    expect(h.records.map((r) => r.id)).toEqual(["A", "B", "CP"]);
    expect(h.records[0]).toMatchObject({ id: "A", result: "pass", expected: ["A works"], observations: [{ id: "A", pass: true }] });
    expect(h.after).toEqual(["A", "B", "CP"]);
    expect(h.holder.state.phase).toBe("checkpoint");
  });

  it("a failed observation fails the step and the run moves on", async () => {
    const h = harness([auto("A", 1, (c) => c.observe("A", { pass: false })), auto("B"), { ...auto("CP"), checkpoint: true }]);
    await h.engine.advance(60_000);
    expect(h.holder.state.done.A.result).toBe("fail");
    expect(h.holder.state.done.B.result).toBe("pass");
  });

  it("a thrown error in a non-blocking step is recorded as a failed observation and the run moves on", async () => {
    const h = harness([auto("A", 1, () => { throw new Error("boom"); }), auto("B")]);
    await h.engine.advance(60_000);
    expect(h.records[0]).toMatchObject({ id: "A", result: "fail" });
    expect(JSON.stringify(h.records[0])).toContain("boom");
    expect(h.holder.state.done.B.result).toBe("pass");
  });

  it("a blocking step's error stops the run, kept for retry or skip", async () => {
    let calls = 0;
    const flaky = { ...auto("A", 1, (c) => { calls += 1; if (calls === 1) throw new Error("no token"); c.observe("A", { pass: true }); }), blocking: true };
    const h = harness([flaky, auto("B")]);
    expect(await h.engine.advance(60_000)).toBe("blocked");
    expect(h.holder.state.done.A).toBeUndefined();
    expect(h.printed.join("\n")).toMatch(/no token/);
    expect(h.records).toEqual([expect.objectContaining({ id: "A", result: "blocked", attempt: 1, error: "no token" })]);
    expect(await h.engine.advance(60_000)).toBe("blocked");
    expect(calls).toBe(1);
    expect(await h.engine.retry(60_000)).not.toBe("blocked");
    expect(h.holder.state.done.A.result).toBe("pass");
  });

  it("a new session (resume) retries a step that blocked in the previous one", async () => {
    let calls = 0;
    const flaky = { ...auto("A", 1, (c) => { calls += 1; if (calls === 1) throw new Error("expiry too far"); c.observe("A", { pass: true }); }), blocking: true };
    const h = harness([flaky, auto("B")]);
    expect(await h.engine.advance(60_000)).toBe("blocked");
    await h.engine.beginSession(1, 60_000);
    expect(calls).toBe(2);
    expect(h.holder.state.done.A.result).toBe("pass");
  });

  it("skip records the reason and moves on", async () => {
    const h = harness([{ ...auto("A", 1, () => { throw new Error("x"); }), blocking: true }, auto("B")]);
    await h.engine.advance(60_000);
    await h.engine.skip("A", "owner decided", 60_000);
    expect(h.holder.state.done.A).toMatchObject({ result: "skipped", reason: "owner decided" });
    expect(h.holder.state.done.B.result).toBe("pass");
  });

  it("a step may mark itself not applicable", async () => {
    const h = harness([auto("A", 1, (c) => c.na("not supplied"))]);
    await h.engine.advance(60_000);
    expect(h.holder.state.done.A.result).toBe("n/a");
  });

  it("stops with 'more' when the time budget is used up, and continues on the next call", async () => {
    const h = harness([auto("A"), auto("B"), auto("C")]);
    expect(await h.engine.advance(1500)).toBe("more");
    expect(Object.keys(h.holder.state.done)).toEqual(["A"]);
    await h.engine.advance(60_000);
    expect(Object.keys(h.holder.state.done)).toEqual(["A", "B", "C"]);
  });
});

describe("owner steps", () => {
  const ownerStep = {
    id: "S6",
    session: 1,
    title: "admin sign-in",
    expected: ["owner admitted"],
    run: (c: Ctx) => c.setFacts({ ran: ((c.facts.ran as number) ?? 0) + 1 }),
    owner: [
      { prompt: () => "Sign in. Reply: ok", verify: (c: Ctx, a: string) => c.observe("owner", { expected: "ok", observed: a, pass: a === "ok" }) },
      { prompt: () => "Tester. Reply: 403", verify: (c: Ctx, a: string) => c.observe("tester", { expected: "403", observed: a, pass: a === "403" }) },
    ],
  };

  it("asks for each confirmation in turn, then records the step", async () => {
    const h = harness([ownerStep, auto("B")]);
    expect(await h.engine.advance(60_000)).toBe("owner");
    expect(h.printed.at(-1)).toContain("Sign in. Reply: ok");
    expect(await h.engine.answer("ok", 60_000)).toBe("owner");
    expect(h.printed.at(-1)).toContain("Tester. Reply: 403");
    await h.engine.answer("403", 60_000);
    expect(h.holder.state.done.S6.result).toBe("pass");
    expect(h.records[0]).toMatchObject({ owner: [{ answer: "ok" }, { answer: "403" }] });
    expect(h.holder.state.done.B.result).toBe("pass");
  });

  it("a waiting prompt survives a reclaimed container: a new engine on the stored state asks again without re-running the step", async () => {
    const h = harness([ownerStep, auto("B")]);
    await h.engine.advance(60_000);
    const stored = await loadState(h.store);
    const h2 = harness([ownerStep, auto("B")], h.store, stored);
    expect(await h2.engine.advance(60_000)).toBe("owner");
    expect(h2.printed.at(-1)).toContain("Sign in. Reply: ok");
    expect(h2.holder.state.facts.ran).toBe(1);
  });

  it("prints a structured prompt as the login whose browser profile it is for, one link, what to do there, then the exact reply (DEC-0793)", async () => {
    const step = { id: "S6", session: 1, title: "admin sign-in", owner: [{ prompt: () => ({ who: "test", link: "https://admin.example/", text: ["Press Sign in with Cloudflare and approve.", 'You should see "Signed in as …".'], reply: "ok" }), verify: () => {} }] };
    const h = harness([step]);
    expect(await h.engine.advance(60_000)).toBe("owner");
    const p = h.printed.at(-1) ?? "";
    const body = p.slice(p.indexOf("===\n") + 4, p.indexOf("\n\nWhen the owner replies"));
    expect(body.split("\n")).toEqual(["In the test account login's browser profile:", "Open: https://admin.example/", "Press Sign in with Cloudflare and approve.", 'You should see "Signed in as …".', "Reply: ok"]);
    expect(p).toContain('When the owner replies, run: node scripts/live-pass/live-pass.mjs answer "<the owner\'s reply, word for word>"');
  });

  it("names the primary account login for a prompt meant for it, and refuses a structured prompt that names no login", async () => {
    const step = { id: "S6", session: 1, title: "admin sign-in", owner: [{ prompt: () => ({ who: "primary", link: "https://admin.example/", text: ["Press Sign in."], reply: "ok" }), verify: () => {} }, { prompt: () => ({ link: "https://admin.example/", text: ["Press Sign in."], reply: "ok" }), verify: () => {} }] };
    const h = harness([step]);
    await h.engine.advance(60_000);
    expect(h.printed.at(-1)).toContain("===\nIn the primary account login's browser profile:\nOpen: https://admin.example/");
    await h.engine.answer("ok", 60_000);
    expect(h.printed.at(-1)).toContain("(the prompt could not be built: it names no login");
  });

  it("a prompt that asks for a pasted value tells the agent to save it as a file and answer `saved`, never to pass the value in a command", async () => {
    const step = { id: "TK", session: 1, title: "starter token", owner: [{ prompt: () => ({ who: "test", link: "https://dash.example/", text: ["Make the token and copy its value."], reply: "paste the value into this chat, or skip" }), saveAs: "LIVE_PASS_STARTER", verify: () => {} }] };
    const h = createEngine({ catalogue: [step], holder: { state: newRun({ runId: "r1", accountId: "a", version: "v", appName: "app", bucket: "b", runnerSha: "s", now: new Date(T0).toISOString() }) }, save: async () => {}, writeStepRecord: () => {}, print: (t: string) => printed.push(t), secretsDir: "/home/u/.live-pass-secrets" });
    const printed: string[] = [];
    await h.advance(60_000);
    const p = printed.at(-1) ?? "";
    expect(p).toContain("Reply: paste the value into this chat, or skip");
    expect(p).toContain("/home/u/.live-pass-secrets/LIVE_PASS_STARTER");
    expect(p).toContain('answer saved');
    expect(p).toContain('answer skip');
  });

  it("skips a part whose `when` is false without asking it, and asks one whose `when` is true", async () => {
    const step = {
      id: "S8",
      session: 1,
      title: "everyday token",
      owner: [
        { prompt: () => "Make it. Reply: ok", verify: (c: Ctx) => c.setFacts({ rolled: true }) },
        { when: (c: Ctx) => c.facts.rolled !== true, prompt: () => "Paste it.", verify: (c: Ctx) => c.observe("pasted", { pass: true }) },
        { when: (c: Ctx) => c.facts.rolled === true, prompt: () => "Check it. Reply: ok", verify: (c: Ctx, a: string) => c.observe("checked", { expected: "ok", observed: a, pass: a === "ok" }) },
      ],
    };
    const h = harness([step]);
    await h.engine.advance(60_000);
    expect(await h.engine.answer("ok", 60_000)).toBe("owner");
    expect(h.printed.at(-1)).toContain("Check it.");
    expect(h.printed.join("\n")).not.toContain("Paste it.");
    expect(h.printed.at(-1)).toContain("part 3 of 3");
    await h.engine.answer("ok", 60_000);
    expect(h.holder.state.done.S8.result).toBe("pass");
    expect(h.records[0]).toMatchObject({ owner: [{ part: 0, answer: "ok" }, { part: 2, answer: "ok" }] });
  });

  it("runs a part's `before` (the runner waiting on its own) before the prompt is asked, and again after a lost container until the prompt is stored", async () => {
    const calls: string[] = [];
    const step = { id: "S14", session: 1, title: "role change", owner: [{ before: async (c: Ctx) => { calls.push("wait"); c.setFacts({ waited: true }); }, prompt: (c: Ctx) => `Reload. Waited: ${String(c.facts.waited)}`, verify: () => {} }] };
    const h = harness([step]);
    expect(await h.engine.advance(60_000)).toBe("owner");
    expect(h.printed.at(-1)).toContain("Waited: true");
    const h2 = harness([step], h.store, await loadState(h.store));
    expect(await h2.engine.advance(60_000)).toBe("owner");
    expect(calls).toEqual(["wait"]);
  });

  it("runs a step's `cleanup` when it completes and when it is skipped partway, recording what it did", async () => {
    const cleaned: string[] = [];
    const step = (id: string) => ({ id, session: 1, title: id, run: (c: Ctx) => c.setFacts({ changed: id }), owner: [{ prompt: () => "Reload. Reply: ok", verify: () => {} }, { prompt: () => "Again. Reply: ok", verify: () => {} }], cleanup: (c: Ctx) => { cleaned.push(id); c.observe("restored", { expected: "restored", observed: "restored", pass: true }); } });
    const h = harness([step("A"), step("B")]);
    await h.engine.advance(60_000);
    await h.engine.answer("ok", 60_000);
    await h.engine.answer("ok", 60_000);
    expect(cleaned).toEqual(["A"]);
    expect(h.records.find((r) => r.id === "A")?.observations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "restored" })]));
    await h.engine.answer("ok", 60_000); // B, part 1 of 2
    await h.engine.skip("B", "the owner stopped here", 60_000);
    expect(cleaned).toEqual(["A", "B"]);
    expect(h.holder.state.done.B).toMatchObject({ result: "skipped" });
    expect(h.records.find((r) => r.id === "B")?.observations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "restored" })]));
  });

  it("refuses an answer when nothing is waiting", async () => {
    const h = harness([auto("A")]);
    await expect(h.engine.answer("ok", 60_000)).rejects.toThrow(/nothing is waiting/);
  });
});

describe("sessions", () => {
  it("runs only the current session's steps and finishes at the final step", async () => {
    const cat = [auto("A", 1), { ...auto("CP", 1), checkpoint: true }, auto("R1", 2), { ...auto("FIN", 2), final: true }];
    const h = harness(cat);
    expect(await h.engine.advance(60_000)).toBe("session-done");
    expect(h.holder.state.done.R1).toBeUndefined();
    expect(await h.engine.advance(60_000)).toBe("session-done");
    expect(await h.engine.beginSession(2, 60_000)).toBe("finished");
    expect(h.holder.state.phase).toBe("finished");
    expect(Object.keys(h.holder.state.done)).toEqual(["A", "CP", "R1", "FIN"]);
  });
});

describe("checkResults", () => {
  it("gives each check ID fail over pass over info", () => {
    expect(checkResults([{ check: "C-3", pass: true }, { check: "C-3", pass: false }, { check: "E-2", pass: null }, { check: "E-2", pass: true }, { check: "A-2", pass: null }, { pass: false }])).toEqual({ "C-3": "fail", "E-2": "pass", "A-2": "info" });
  });

  it("is stored with the step's result", async () => {
    const h = harness([auto("A", 1, (c) => c.observe("x", { check: "C-4", pass: true }))]);
    await h.engine.advance(60_000);
    expect(h.holder.state.done.A.checks).toEqual({ "C-4": "pass" });
  });
});
