// The live pass's durable state and the checkpoint between session 1 and session 2.
//
// The state is one JSON object, saved after every step to the records bucket in the test account
// (`runs/<runId>/state.json`, plus `latest.json` naming the newest run), so it survives the
// container being reclaimed. The run has two parts, called sessions in the state ("session" 1 and 2),
// both in one Claude session since DEC-0793: part 1 uses the starter tokens and does the setup; part 2
// uses the everyday token. The checkpoint is the state with `phase: "checkpoint"`: every part-1 step
// done, and the facts part 2 needs (URLs, IDs, people, stages); the runner then begins part 2 at once.
// `resume` (in a new container) continues the part the run is in.
//
// Each save carries a revision; a save over a newer stored revision is refused, so two sessions
// never run the same run at once.

export class CheckpointError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckpointError";
  }
}

export const SCHEMA = 1;
export const LATEST_KEY = "latest.json";
export const PHASES = ["session-1", "checkpoint", "session-2", "finished"];
export const RESULTS = ["pass", "fail", "n/a", "skipped", "info"];

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export const runPrefix = (runId) => `runs/${runId}/`;
export const stateKey = (runId) => `${runPrefix(runId)}state.json`;

/** A new run in session 1. */
export function newRun({ runId, accountId, version, appName, bucket, runnerSha, now }) {
  if (typeof runId !== "string" || !SAFE_ID.test(runId)) throw new CheckpointError(`run ID ${JSON.stringify(runId)} is not safe in an object key`);
  return {
    schema: SCHEMA,
    runId,
    prefix: runPrefix(runId),
    bucket,
    accountId,
    version,
    appName,
    runnerSha,
    createdAt: now,
    updatedAt: now,
    phase: "session-1",
    session: 1,
    sessions: [{ number: 1, startedAt: now }],
    revision: 0,
    seq: 0,
    done: {},
    pending: null,
    facts: {},
    checkpointAt: null,
  };
}

/** Throws a CheckpointError naming every problem; returns the state when it is valid. */
export function validateState(s) {
  if (s === null || typeof s !== "object" || Array.isArray(s)) throw new CheckpointError("the state is not a JSON object");
  const problems = [];
  if (s.schema !== SCHEMA) problems.push(`schema is ${JSON.stringify(s.schema)}, expected ${SCHEMA}`);
  if (typeof s.runId !== "string" || !SAFE_ID.test(s.runId)) problems.push("runId is missing or unsafe");
  for (const f of ["bucket", "accountId", "version", "appName", "createdAt", "updatedAt"]) if (typeof s[f] !== "string") problems.push(`${f} is missing`);
  if (!PHASES.includes(s.phase)) problems.push(`phase ${JSON.stringify(s.phase)} is not one of ${PHASES.join(", ")}`);
  if (s.session !== 1 && s.session !== 2) problems.push(`session ${JSON.stringify(s.session)} is not 1 or 2`);
  if (!Number.isInteger(s.revision) || s.revision < 0) problems.push("revision is not a non-negative integer");
  if (!Number.isInteger(s.seq) || s.seq < 0) problems.push("seq is not a non-negative integer");
  if (s.done === null || typeof s.done !== "object") problems.push("done is not an object");
  if (s.facts === null || typeof s.facts !== "object") problems.push("facts is not an object");
  if (!Array.isArray(s.sessions)) problems.push("sessions is not a list");
  if (problems.length > 0) throw new CheckpointError(`the state is not valid: ${problems.join("; ")}`);
  return s;
}

const bump = (s, changes) => ({ ...s, ...changes, revision: s.revision + 1 });

/** The state with one step's result recorded (a pending prompt of that step is cleared). */
export function recordStep(s, stepId, outcome) {
  if (!RESULTS.includes(outcome.result)) throw new CheckpointError(`result ${JSON.stringify(outcome.result)} is not one of ${RESULTS.join(", ")}`);
  return bump(s, {
    done: { ...s.done, [stepId]: { ...outcome } },
    pending: s.pending?.stepId === stepId ? null : s.pending,
    updatedAt: outcome.endedAt ?? s.updatedAt,
  });
}

/**
 * The state with some steps' results forgotten and nothing pending: the run asks them again, in
 * catalogue order. Used when a later step finds an earlier one's result unusable in this container
 * (a starter token or the everyday token's value that was only in a lost container's secrets directory).
 */
export function rewind(s, stepIds) {
  const missing = stepIds.filter((id) => s.done[id] === undefined);
  if (missing.length > 0) throw new CheckpointError(`cannot go back to ${missing.join(", ")}: no result recorded`);
  const done = Object.fromEntries(Object.entries(s.done).filter(([id]) => !stepIds.includes(id)));
  return bump(s, { done, pending: null });
}

/** The state with new facts merged in. */
export function withFacts(s, facts) {
  return bump(s, { facts: { ...s.facts, ...facts } });
}

/** The state waiting for the owner's reply to a prompt of a step. */
export function withPending(s, pending) {
  return bump(s, { pending: pending === null ? null : { ...pending } });
}

/** The next sequence number (for record keys) and the state that reserved it. */
export function nextSeq(s) {
  const seq = s.seq + 1;
  return [seq, { ...s, seq }];
}

/** The first step of the current session that has no result yet, or null. */
export function nextStep(s, catalogue) {
  for (const step of catalogue) {
    if (step.session !== s.session) continue;
    if (s.done[step.id] === undefined) return step;
  }
  return null;
}

/** Session 1's steps without a result (the checkpoint step itself excluded). */
function unfinishedSession1(s, catalogue) {
  return catalogue.filter((x) => x.session === 1 && !x.checkpoint && s.done[x.id] === undefined).map((x) => x.id);
}

/** The state at the checkpoint: every session-1 step has a result. */
export function toCheckpoint(s, catalogue, now, outcome = { result: "pass" }) {
  const open = unfinishedSession1(s, catalogue);
  if (open.length > 0) throw new CheckpointError(`session 1 is not finished: no result yet for ${open.join(", ")}`);
  const cp = catalogue.find((x) => x.checkpoint);
  const done = cp === undefined ? s.done : { ...s.done, [cp.id]: { ...outcome, endedAt: now } };
  const sessions = s.sessions.map((x, i) => (i === s.sessions.length - 1 && x.endedAt === undefined ? { ...x, endedAt: now } : x));
  return bump(s, { phase: "checkpoint", checkpointAt: now, done, sessions, pending: null, updatedAt: now });
}

/**
 * Starts (or continues, after a reclaimed container) a session. Session 2 starts only from the
 * checkpoint or continues session 2; session 1 continues only while the run is in session 1.
 */
export function beginSession(s, number, now) {
  if (number === 1) {
    if (s.phase !== "session-1") throw new CheckpointError(`the run is at phase ${s.phase}: session 1 cannot continue`);
  } else if (number === 2) {
    if (s.phase !== "checkpoint" && s.phase !== "session-2") throw new CheckpointError(`session 2 starts only from the checkpoint; the run is at phase ${s.phase}`);
  } else {
    throw new CheckpointError(`there is no session ${String(number)}`);
  }
  return bump(s, { phase: number === 1 ? "session-1" : "session-2", session: number, sessions: [...s.sessions, { number, startedAt: now }], updatedAt: now });
}

/** The state at the end of the run. */
export function finish(s, now) {
  const sessions = s.sessions.map((x, i) => (i === s.sessions.length - 1 && x.endedAt === undefined ? { ...x, endedAt: now } : x));
  return bump(s, { phase: "finished", sessions, pending: null, updatedAt: now, finishedAt: now });
}

/** An in-memory store, for tests. */
export function memoryStore() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      return objects.has(key) ? objects.get(key) : null;
    },
    async put(key, body) {
      objects.set(key, String(body));
    },
  };
}

/** Saves the state and the latest pointer; refuses to overwrite a newer stored revision. */
export async function saveState(store, s) {
  validateState(s);
  const key = stateKey(s.runId);
  const stored = await store.get(key);
  if (stored !== null) {
    let current;
    try {
      current = JSON.parse(stored);
    } catch {
      current = null;
    }
    if (current !== null && Number.isInteger(current.revision) && current.revision > s.revision) {
      throw new CheckpointError(`the stored state ${key} has revision ${current.revision}, newer than this session's ${s.revision}: another session is running this run, or this one is stale. Run "resume" to continue from the stored state.`);
    }
  }
  await store.put(key, `${JSON.stringify(s, null, 2)}\n`);
  await store.put(LATEST_KEY, `${JSON.stringify({ runId: s.runId, key, phase: s.phase, updatedAt: s.updatedAt })}\n`);
}

/** Loads a run's state (the latest run when no ID is given); null when there is none. */
export async function loadState(store, runId) {
  let key;
  if (runId === undefined) {
    const latest = await store.get(LATEST_KEY);
    if (latest === null) return null;
    try {
      key = JSON.parse(latest).key;
    } catch {
      throw new CheckpointError(`${LATEST_KEY} is not valid JSON`);
    }
    if (typeof key !== "string") throw new CheckpointError(`${LATEST_KEY} names no state key`);
  } else {
    key = stateKey(runId);
  }
  const body = await store.get(key);
  if (body === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new CheckpointError(`${key} is not valid JSON`);
  }
  try {
    return validateState(parsed);
  } catch (e) {
    throw new CheckpointError(`${key}: ${e.message}`);
  }
}
