// The live-pass step engine: runs the catalogue's steps of the current session in order, across
// as many invocations as the run needs.
//
// A step has an automated part (`run`), then zero or more owner parts (`owner[i].prompt`, then
// `owner[i].verify` with the owner's short reply), then an automated `after`. Every part records
// observations: expected against observed, with pass true, false or null (recorded only). The
// step's result follows from them (`stepResult`). The step in progress, its observations and a
// waiting prompt live in the state (`pending`), which is saved to the records bucket after every
// part, so a reclaimed container loses nothing: the next invocation asks the same question again.
//
// `advance` returns why it stopped: "owner" (a prompt is waiting), "more" (the time budget is used;
// call again), "blocked" (a blocking step failed: retry or skip), "session-done" (the checkpoint or
// the end of the session's steps), "finished" (the final step is done).
import { beginSession as beginSessionState, finish, nextStep, recordStep, toCheckpoint, withFacts, withPending } from "./checkpoint.mjs";

/** A step's result from its observations. */
export function stepResult(observations, notApplicable) {
  if (observations.some((o) => o.pass === false)) return "fail";
  if (observations.some((o) => o.pass === true)) return "pass";
  return notApplicable ? "n/a" : "info";
}

const message = (e) => (e instanceof Error ? e.message : String(e));

/**
 * @param {{ catalogue: any[], holder: { state: any }, save: (s: any) => Promise<void>, makeCtx?: (base: any, step: any) => any,
 *   afterStep?: (ctx: any, step: any, record: any) => Promise<void>, writeStepRecord: (r: any) => void, print: (t: string) => void, now?: () => number }} o
 */
export function createEngine({ catalogue, holder, save, makeCtx = (base) => base, afterStep = async () => {}, writeStepRecord, print, now = () => Date.now() }) {
  const iso = () => new Date(now()).toISOString();
  const byId = (id) => catalogue.find((s) => s.id === id);

  const setPending = (p) => {
    holder.state = withPending(holder.state, p);
  };
  const pending = () => holder.state.pending;

  const ctxFor = (step) => {
    const base = {
      step,
      get state() {
        return holder.state;
      },
      get facts() {
        return holder.state.facts;
      },
      setFacts(f) {
        holder.state = withFacts(holder.state, f);
      },
      observe(id, o) {
        const p = pending();
        p.record.observations.push({ id, at: iso(), ...o });
      },
      note(text) {
        pending().record.notes.push({ at: iso(), text });
      },
      na(why) {
        const p = pending();
        p.record.notApplicable = why;
      },
      addCommand(ref) {
        pending().record.commands.push(ref);
      },
    };
    return makeCtx(base, step);
  };

  const prompt = (step, p) => {
    print(`\n=== OWNER STEP ${step.id} (part ${p.part + 1} of ${step.owner.length}): ${step.title} ===\n${p.prompt}\n\nWhen the owner replies, run: node scripts/live-pass/live-pass.mjs answer "<the owner's reply, word for word>"`);
  };

  async function complete(step, ctx) {
    const p = pending();
    if (step.after) {
      try {
        await step.after(ctx);
      } catch (e) {
        ctx.observe("error", { expected: "the step's checks run", observed: message(e), pass: false });
      }
    }
    const rec = { ...p.record, endedAt: iso() };
    rec.result = stepResult(rec.observations, rec.notApplicable !== undefined);
    try {
      await afterStep(ctx, step, rec);
    } catch (e) {
      rec.notes.push({ at: iso(), text: `after-step collection failed: ${message(e)}` });
    }
    writeStepRecord(rec);
    const outcome = { result: rec.result, endedAt: rec.endedAt, ...(rec.notApplicable ? { reason: rec.notApplicable } : {}) };
    if (step.checkpoint) holder.state = toCheckpoint(holder.state, catalogue, rec.endedAt, outcome);
    else holder.state = recordStep(holder.state, step.id, outcome);
    if (step.final) holder.state = finish(holder.state, rec.endedAt);
    await save(holder.state);
    return step.checkpoint ? "session-done" : step.final ? "finished" : "done";
  }

  /** Runs (or continues) one step until it completes, waits for the owner, or blocks. */
  async function runStep(step) {
    if (pending()?.stepId !== step.id) {
      setPending({
        stepId: step.id,
        part: 0,
        ran: false,
        record: { id: step.id, title: step.title, session: holder.state.session, check: step.check, expected: step.expected ?? [], startedAt: iso(), startedAtMs: now(), observations: [], commands: [], owner: [], notes: [] },
      });
    }
    const ctx = ctxFor(step);
    if (!pending().ran) {
      if (step.run) {
        try {
          await step.run(ctx);
        } catch (e) {
          if (step.blocking) {
            setPending({ ...pending(), blocked: message(e), record: { ...pending().record, observations: [], notes: [] } });
            await save(holder.state);
            print(`\n=== BLOCKED at ${step.id}: ${step.title} ===\n${message(e)}\n\nThis step must pass before the run can go on. Tell the owner what it says. Then run "node scripts/live-pass/live-pass.mjs retry" once it is fixed, or "node scripts/live-pass/live-pass.mjs skip ${step.id} \\"<reason>\\"" if the owner decides to go on without it.`);
            return "blocked";
          }
          ctx.observe("error", { expected: "the step runs", observed: message(e), pass: false });
        }
      }
      setPending({ ...pending(), ran: true });
      await save(holder.state);
    }
    const parts = step.owner ?? [];
    while (pending().part < parts.length) {
      const p = pending();
      if (p.prompt === undefined) {
        let text;
        try {
          text = parts[p.part].prompt(ctx);
        } catch (e) {
          text = `(the prompt could not be built: ${message(e)})`;
        }
        setPending({ ...p, prompt: text, askedAt: iso() });
        await save(holder.state);
      }
      prompt(step, pending());
      return "owner";
    }
    return complete(step, ctx);
  }

  async function advance(budgetMs) {
    const start = now();
    let first = true;
    for (;;) {
      const p = pending();
      if (p?.blocked !== undefined) {
        print(`\n=== BLOCKED at ${p.stepId} ===\n${p.blocked}\nRun "retry" once it is fixed, or "skip ${p.stepId} \\"<reason>\\"".`);
        return "blocked";
      }
      if (p?.prompt !== undefined) {
        prompt(byId(p.stepId), p);
        return "owner";
      }
      const step = p ? byId(p.stepId) : nextStep(holder.state, catalogue);
      if (!step) return holder.state.phase === "finished" ? "finished" : "session-done";
      if (!first && now() - start > budgetMs) return "more";
      first = false;
      const outcome = await runStep(step);
      if (outcome !== "done") return outcome;
    }
  }

  async function answer(text, budgetMs) {
    const p = pending();
    if (p?.prompt === undefined) throw new Error("nothing is waiting for an owner reply");
    const step = byId(p.stepId);
    const ctx = ctxFor(step);
    pending().record.owner.push({ part: p.part, prompt: p.prompt, askedAt: p.askedAt, answer: text, answeredAt: iso() });
    const verify = step.owner[p.part].verify;
    if (verify) {
      try {
        await verify(ctx, text);
      } catch (e) {
        ctx.observe("error", { expected: "the owner step's checks run", observed: message(e), pass: false });
      }
    }
    const { prompt: _p, askedAt: _a, ...rest } = pending();
    setPending({ ...rest, part: p.part + 1 });
    await save(holder.state);
    const outcome = await runStep(step);
    if (outcome !== "done") return outcome;
    return advance(budgetMs);
  }

  async function retry(budgetMs) {
    const p = pending();
    if (p?.blocked === undefined) throw new Error("nothing is blocked");
    setPending(null);
    await save(holder.state);
    return advance(budgetMs);
  }

  async function skip(stepId, reason, budgetMs) {
    if (!byId(stepId)) throw new Error(`there is no step ${stepId}`);
    if (pending()?.stepId === stepId) setPending(null);
    holder.state = recordStep(holder.state, stepId, { result: "skipped", reason, endedAt: iso() });
    writeStepRecord({ id: stepId, title: byId(stepId).title, result: "skipped", reason, endedAt: iso(), observations: [], commands: [], owner: [], notes: [] });
    await save(holder.state);
    return advance(budgetMs);
  }

  async function beginSession(number, budgetMs) {
    holder.state = beginSessionState(holder.state, number, iso());
    await save(holder.state);
    return advance(budgetMs);
  }

  return { advance, answer, retry, skip, beginSession };
}
