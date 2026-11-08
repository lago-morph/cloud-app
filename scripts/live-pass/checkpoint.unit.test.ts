// Unit tests for the live-pass runner's durable state and checkpoint (scripts/live-pass/lib/checkpoint.mjs).
// Written from the brief: part 1 (starter tokens, setup) and part 2 (the everyday token), called
// sessions 1 and 2 in the state and run in one Claude session since DEC-0793, are separated by a
// checkpoint stored in the test Cloudflare account that survives the container being reclaimed, holds
// everything part 2 needs, and is resumed with one command.
import { describe, expect, it } from "vitest";
import {
  beginSession,
  CheckpointError,
  LATEST_KEY,
  loadState,
  memoryStore,
  newRun,
  nextStep,
  recordStep,
  rewind,
  saveState,
  stateKey,
  toCheckpoint,
  validateState,
} from "./lib/checkpoint.mjs";

const T0 = "2026-11-03T10:00:00.000Z";
const CATALOGUE = [
  { id: "P1", session: 1 },
  { id: "S4", session: 1 },
  { id: "S8", session: 1 },
  { id: "CP", session: 1, checkpoint: true },
  { id: "R1", session: 2 },
  { id: "S12", session: 2 },
];

const run = () =>
  newRun({ runId: "lp-20261103-100000", accountId: "acc", version: "0.2.0-rc01", appName: "livepass", bucket: "live-pass-records", runnerSha: "abc", now: T0 });

const doneThrough = (state: ReturnType<typeof run>, ids: string[]) =>
  ids.reduce((s, id) => recordStep(s, id, { result: "pass", endedAt: T0 }), state);

describe("a new run", () => {
  it("starts in session 1 at revision 0 with no step done and nothing pending", () => {
    const s = run();
    expect(s).toMatchObject({ schema: 1, runId: "lp-20261103-100000", phase: "session-1", session: 1, revision: 0, done: {}, pending: null });
    expect(s.prefix).toBe("runs/lp-20261103-100000/");
    expect(() => validateState(s)).not.toThrow();
  });

  it("refuses a run ID that is not safe in an object key", () => {
    expect(() => newRun({ runId: "../x", accountId: "a", version: "v", appName: "a", bucket: "b", runnerSha: "s", now: T0 })).toThrow(CheckpointError);
  });
});

describe("validateState", () => {
  it("names every missing or wrong field", () => {
    expect(() => validateState({ schema: 2 })).toThrow(/schema.*runId|runId/s);
    expect(() => validateState(null)).toThrow(CheckpointError);
    expect(() => validateState({ ...run(), phase: "nowhere" })).toThrow(/phase/);
    expect(() => validateState({ ...run(), session: 3 })).toThrow(/session/);
  });
});

describe("nextStep", () => {
  it("returns the first step of the current session that is neither done nor skipped", () => {
    const s = doneThrough(run(), ["P1"]);
    expect(nextStep(s, CATALOGUE)?.id).toBe("S4");
    expect(nextStep(recordStep(s, "S4", { result: "skipped", endedAt: T0 }), CATALOGUE)?.id).toBe("S8");
  });

  it("counts a failed step as done (its result is recorded), so the run moves on", () => {
    expect(nextStep(recordStep(doneThrough(run(), ["P1"]), "S4", { result: "fail", endedAt: T0 }), CATALOGUE)?.id).toBe("S8");
  });

  it("never returns a step of the other session", () => {
    const s = doneThrough(run(), ["P1", "S4", "S8", "CP"]);
    expect(nextStep(s, CATALOGUE)).toBeNull();
  });
});

describe("rewind", () => {
  it("forgets the named steps' results and the pending step, so the run asks them again in order (2026-11-08 lost starter token)", () => {
    const s0 = { ...doneThrough(run(), ["P1", "S4"]), pending: { stepId: "S8", part: 0, ran: false, record: {} } };
    const s = rewind(s0, ["S4"]);
    expect(Object.keys(s.done)).toEqual(["P1"]);
    expect(s.pending).toBeNull();
    expect(s.revision).toBe(s0.revision + 1);
    expect(nextStep(s, CATALOGUE)?.id).toBe("S4");
    expect(Object.keys(s0.done)).toEqual(["P1", "S4"]);
  });

  it("refuses to forget a step that has no result", () => {
    expect(() => rewind(doneThrough(run(), ["P1"]), ["R1"])).toThrow(CheckpointError);
  });
});

describe("recordStep", () => {
  it("does not modify the state it is given, raises the revision and clears a pending prompt of that step", () => {
    const s = { ...run(), pending: { stepId: "S4", part: 0, prompt: "p", askedAt: T0 } };
    const t = recordStep(s, "S4", { result: "pass", endedAt: T0 });
    expect(s.done).toEqual({});
    expect(t.done.S4).toEqual({ result: "pass", endedAt: T0 });
    expect(t.pending).toBeNull();
    expect(t.revision).toBe(s.revision + 1);
  });

  it("refuses an unknown result", () => {
    expect(() => recordStep(run(), "S4", { result: "maybe", endedAt: T0 })).toThrow(/result/);
  });
});

describe("toCheckpoint", () => {
  it("refuses while a session-1 step before the checkpoint is not done, naming it", () => {
    expect(() => toCheckpoint(doneThrough(run(), ["P1"]), CATALOGUE, T0)).toThrow(/S4.*S8|S8/);
  });

  it("moves to phase checkpoint once every session-1 step is done", () => {
    const s = toCheckpoint(doneThrough(run(), ["P1", "S4", "S8"]), CATALOGUE, T0);
    expect(s.phase).toBe("checkpoint");
    expect(s.done.CP).toMatchObject({ result: "pass" });
    expect(s.checkpointAt).toBe(T0);
  });
});

describe("beginSession", () => {
  it("starts session 2 only from the checkpoint, keeping facts and done steps", () => {
    const cp = toCheckpoint({ ...doneThrough(run(), ["P1", "S4", "S8"]), facts: { adminUrl: "https://a" } }, CATALOGUE, T0);
    const s = beginSession(cp, 2, "2026-11-03T12:00:00.000Z");
    expect(s).toMatchObject({ phase: "session-2", session: 2, facts: { adminUrl: "https://a" } });
    expect(s.sessions.map((x: { number: number }) => x.number)).toEqual([1, 2]);
    expect(nextStep(s, CATALOGUE)?.id).toBe("R1");
  });

  it("refuses session 2 before the checkpoint", () => {
    expect(() => beginSession(run(), 2, T0)).toThrow(/checkpoint/);
  });

  it("lets session 2 continue after a reclaimed container (same session again)", () => {
    const s2 = beginSession(toCheckpoint(doneThrough(run(), ["P1", "S4", "S8"]), CATALOGUE, T0), 2, T0);
    const again = beginSession(doneThrough(s2, ["R1"]), 2, "2026-11-03T13:00:00.000Z");
    expect(nextStep(again, CATALOGUE)?.id).toBe("S12");
    expect(again.sessions).toHaveLength(3);
  });

  it("lets session 1 continue after a reclaimed container, and refuses to go back from session 2", () => {
    const s = beginSession(doneThrough(run(), ["P1"]), 1, T0);
    expect(nextStep(s, CATALOGUE)?.id).toBe("S4");
    const s2 = beginSession(toCheckpoint(doneThrough(run(), ["P1", "S4", "S8"]), CATALOGUE, T0), 2, T0);
    expect(() => beginSession(s2, 1, T0)).toThrow(/session 1/);
  });
});

describe("the durable store", () => {
  it("saves the state and the latest pointer, and loads it back by pointer or by run ID", async () => {
    const store = memoryStore();
    const s = run();
    await saveState(store, s);
    expect(JSON.parse((await store.get(LATEST_KEY)) ?? "{}")).toMatchObject({ runId: s.runId, key: stateKey(s.runId) });
    expect(await loadState(store)).toEqual(s);
    expect(await loadState(store, s.runId)).toEqual(s);
  });

  it("loads nothing (null) when there is no run", async () => {
    expect(await loadState(memoryStore())).toBeNull();
  });

  it("refuses to overwrite a newer stored revision (two sessions running the same run)", async () => {
    const store = memoryStore();
    const s = run();
    await saveState(store, recordStep(recordStep(s, "P1", { result: "pass", endedAt: T0 }), "S4", { result: "pass", endedAt: T0 }));
    await expect(saveState(store, recordStep(s, "P1", { result: "pass", endedAt: T0 }))).rejects.toThrow(/revision/);
  });

  it("refuses a stored state that is not valid, naming the key", async () => {
    const store = memoryStore();
    await store.put(LATEST_KEY, JSON.stringify({ runId: "r1", key: stateKey("r1") }));
    await store.put(stateKey("r1"), "{not json");
    await expect(loadState(store)).rejects.toThrow(/runs\/r1\/state\.json/);
  });
});
