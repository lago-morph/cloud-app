# Root cause: SKILL-AC-004 "no example derived from `apps/demo/`" fails because the demo kept template files unchanged

Author: diagnosing subagent (prompt §8 step 1). It did not write the skill, the demo or the tests. This is a diagnosis only: no code, skill text, docs or test changed. It needs independent review (§8 step 2) before any fix.

## Symptom
Branch `claude/implement-local-cloudflare-diag-e4`, made from `origin/claude/implement-local-cloudflare` after F-01 merged the demo (`8199c21`). Only the failing file was run (plan §1 "Test economy"):

```
npx vitest run --config vitest.unit.config.ts tests/skill/example-copies.unit.test.ts
 × [SKILL-AC-004] no example is derived from apps/demo/: every source is a file of apps/template or apps/reference, and no block equals a demo file
 + "skill/examples/configuration.md:49: block equals apps/demo/config/cloudflare/test.json",
 + "skill/examples/configuration.md:49: block equals apps/demo/config/local.json",
 + "skill/examples/configuration.md:59: block equals apps/demo/config/cloudflare/test.json",
 + "skill/examples/configuration.md:59: block equals apps/demo/config/local.json",
 + "skill/examples/secrets.md:98: block equals apps/demo/src/server/signing.ts",
 + "skill/examples/secrets.md:150: block equals apps/demo/tests/signing.test.ts",
 Tests  1 failed | 5 passed (6)
```

The other five tests in the file pass. One of them is "every code block is byte-for-byte the source file it names".

## Evidence
1. **Each flagged block names a template source.** The marker directly before each block reads as follows:
   - `configuration.md:49`: `<!-- example-source: apps/template/config/local.json -->`
   - `configuration.md:59`: `<!-- example-source: apps/template/config/cloudflare/test.json -->`
   - `secrets.md:98`: `<!-- example-source: apps/template/src/server/signing.ts -->`
   - `secrets.md:150`: `<!-- example-source: apps/template/tests/signing.test.ts -->`

   The passing byte-for-byte test shows that each block equals its named template file.
2. **The demo files are identical to the template files.** `sha1sum` gives:
   - `apps/template/config/local.json` = `apps/template/config/cloudflare/test.json` = `apps/demo/config/local.json` = `apps/demo/config/cloudflare/test.json` = `2341f94c…` (content `{"values": {}, "framework": {}}`). Both config blocks match two demo files each because the two template config files are themselves identical.
   - `apps/template/src/server/signing.ts` = `apps/demo/src/server/signing.ts` = `72bbe3b6…`
   - `apps/template/tests/signing.test.ts` = `apps/demo/tests/signing.test.ts` = `0865bada…`
3. **The examples are older than the demo.** From `git log`:
   - `ef0e2cb` (2026-10-20 07:54) E-01 added `skill/examples/configuration.md` and `secrets.md`, copied from the template.
   - `59efd6c` (08:25) E-03 added `apps/template/src/server/signing.ts` and `tests/signing.test.ts`.
   - `b63eaa5` (08:27) E-03 copied them into the examples.

   No later commit touches these example files or template sources. The demo files were first added in `8199c21` (15:16), about 7 hours later. An example cannot have been derived from a file that did not exist yet.
4. **The demo was built by copying the template.** `apps/demo/BUILD-RECORD.md` says: "copied `apps/template` into `apps/demo`, keeping the pins unchanged". Prompt §9 F says to build the demo from the skill and the template. `diff -rq apps/template apps/demo` shows that most template files were changed or replaced (for example `src/app.ts` and `src/client/*`), while `signing.ts`, its test and the empty config files were kept unchanged. So the demo holds unchanged template files by design.
5. **No block matches a demo-only file.** All six hits involve demo files that are byte-identical to the block's declared template source (evidence 1 and 2). No block equals a demo file that differs from the template or the reference app.
6. **Criterion and readings.**
   - SKILL-AC-004 says: "No example file is derived from `apps/demo/`."
   - Prompt §9 E says: "The skill's examples come from the template and the reference app only."
   - The decision log (line 323) says the examples never come from the demo, "which avoids a circular dependency".
   - DEC-0389 (E-T1, accepted) reads "derived from" as "its code blocks are copies of that app's files". It then adds a proxy clause: "No block may equal a non-empty `apps/demo/` file."

   That proxy assumes a file identical to a demo file must have come from the demo. The assumption does not hold once the demo legitimately copies template files (evidence 4).

## Chain (cause → symptom)
1. E-01 and E-03 copied the template files into the examples and named them correctly. This happened before the demo existed (evidence 1 and 3).
2. F-01 built the demo by copying the template and left four of those files unchanged (evidence 2 and 4).
3. DEC-0389's proxy clause, implemented in the test's second loop, flags any block that is byte-equal to any non-empty demo file. It does not check whether the same bytes are also the block's template or reference source.
4. So each template-derived block that the demo also kept unchanged is reported. That gives six hits: two config blocks × two identical demo files, plus the two signing files (symptom).

## Alternatives considered
- **An example was actually taken from the demo.** Ruled out. Every flagged block names a template source and equals it (evidence 1). The blocks were committed hours before any demo file existed (evidence 3). No block equals a demo-only file (evidence 5).
- **The demo should not contain unchanged template files.** Rejected. Prompt §9 F requires the demo to be built from the template, and `BUILD-RECORD.md` records doing exactly that. Forcing the demo to differ would mean editing the demo to satisfy a test proxy, which is a symptom fix.
- **Drop the demo-equality check.** Rejected as weakening the test (§8). The check still has a job: catching code whose bytes exist only in the demo.

## Proposed fix (test and decision, not skill or demo)
Make the second loop of the "no example is derived from apps/demo/" test in `tests/skill/example-copies.unit.test.ts` flag a block only in one of two cases:
- the block equals a non-empty `apps/demo/` file and is **not** byte-equal to its declared source in `apps/template` or `apps/reference`;
- the block equals a demo file and its marker names a source outside those two apps. The first loop already catches that case.

A demo file that is byte-identical to the block's verified template or reference source is not evidence of derivation from the demo. Keep the first loop and the byte-for-byte test unchanged. Together they still require each block to name a template or reference file and equal it.

Record this as a new DEC entry that refines DEC-0389's last sentence to: "No block may equal a non-empty `apps/demo/` file unless it also equals its declared `apps/template`/`apps/reference` source." Update the test header comment to match. The owner is a test-author item (E-T line), with independent review.

## Verification
- **Red:** the command under Symptom fails with the six items, as observed.
- **Green:** after the change, the same command passes 6 of 6.
- **Negative controls**, run on a scratch copy and not committed:
  - A block whose bytes come from a demo-only file (for example `apps/demo/src/server/access.ts`) under a marker naming a template path is still reported. The demo-equality loop and the byte-for-byte test both report it.
  - A marker naming `apps/demo/...` is still reported by the first loop.
- The test runner and the evaluator re-run SKILL-AC-004 (§8 step 4).

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). It did not diagnose this failure or write the skill, the demo or the tests. Branch `claude/implement-local-cloudflare-rc-e4-review`, from `origin/claude/implement-local-cloudflare`. No code, skill text, docs or tests were changed.

**Verdict: ACCEPTED.**

### Checks
- **Reproduced.** Ran only `npx vitest run --config vitest.unit.config.ts tests/skill/example-copies.unit.test.ts`. The result was 1 failed and 5 passed, with the same six `block equals apps/demo/...` items as the Symptom section.
- **Evidence 1 (markers) holds.** The markers directly before the flagged fences, at lines 48, 58, 97 and 149, name `apps/template/config/local.json`, `apps/template/config/cloudflare/test.json`, `apps/template/src/server/signing.ts` and `apps/template/tests/signing.test.ts`. The byte-for-byte test passes.
- **Evidence 2 (identical bytes) holds.** `sha1sum` gives the same values as the record: `2341f94c…` for all four config files, `72bbe3b6…` for both copies of `signing.ts` and `0865bada…` for both copies of `signing.test.ts`.
- **Evidence 3 (ordering) holds.** The examples were changed only in `ef0e2cb` (07:54) and `b63eaa5` (08:27). The template sources date from `6ec5f3d` (10-19) and `59efd6c` (08:25). Before `8199c21` (15:16), `apps/demo` held only `package.json`, added by B-01 `9e6d808`. All four flagged demo files were first added in `8199c21`, so the demo copies came after the examples.
- **Evidence 4 (demo copied from the template) holds.** `BUILD-RECORD.md` line 24 records the copy. `diff -rq apps/template apps/demo` shows broad divergence: `app.ts`, client pages and routes differ, and there are demo-only files such as `access.ts`, `posts.ts` and `photos.ts`.
- **Alternatives.** The "really derived from the demo" alternative is ruled out by the dates and the markers. Rejecting "make the demo differ" and "drop the check" agrees with §8 and DEC-0054.
- **The fix targets the cause.** The cause is the proxy in DEC-0389's last sentence: byte equality with any demo file. That proxy cannot tell a legitimate template copy from demo-derived code. The fix narrows the proxy rather than changing the skill or the demo.

### Does the proposed rule still catch real violations?
- **A block taken from a demo-only file** (for example `apps/demo/src/server/access.ts`, which exists only in the demo) is still caught. A template or reference marker would fail the byte-for-byte test and the demo clause. An `apps/demo/` marker fails the first loop.
- **A block taken from a demo file that diverged from the template** (for example the demo's `src/app.ts`) is still caught. Its bytes differ from the declared template source, so both the byte-for-byte test and the narrowed demo clause report it.
- **Note.** For a block whose marker is valid and whose source exists, the narrowed clause can fire only when the byte-for-byte test also fires. Its remaining independent value is for blocks with no marker, a malformed marker, a non-app marker or a missing source. The fix must keep the clause effective for those blocks (requirement 2).
- **Residual limit.** Demo code that is first copied into `apps/template` or `apps/reference` and then into an example cannot be detected from bytes. Any byte-equality proxy, the current one included, either misses it or also flags legitimate copies. That route needs a change to a verified app, which that app's `verify` and review cover. Record this limit in the decision rather than leave it implicit.

### Fix requirements (step 3, red-green, test-author E-T item with independent review)
1. **Red first.** Before editing, confirm the unchanged test fails with exactly the six items above.
2. **Narrow the demo clause in the second test only.** A block that is non-empty and byte-equal (`sameBytes`) to a non-empty `apps/demo/` file is reported unless all of these hold:
   - its marker is present and directly adjacent;
   - the marker's path passes the existing plain-path and `apps/template`|`apps/reference` checks;
   - the declared source file exists;
   - `sameBytes(block, declared source)` is true.

   Blocks with no marker or with an invalid or missing source must still be reported when they equal a demo file. Keep the message format `block equals <demo path>`.
3. **Leave the rest unchanged.** Do not change the first loop of that test, the other five tests, `support.ts`, any skill example, any template or reference file, or any demo file. Do not skip or delete a test.
4. **Update the comment.** In the file header, change the bullet "no block equals a file of `apps/demo/`" to "no block equals a file of `apps/demo/` unless it also equals its declared `apps/template`/`apps/reference` source". Cite the new DEC.
5. **Run negative controls on a scratch copy, not committed, and report the output.**
   - (a) A block with the bytes of `apps/demo/src/server/access.ts` under a template marker is reported by the demo clause and the byte-for-byte test.
   - (b) The same block with no marker is reported by the demo clause.
   - (c) A marker naming `apps/demo/...` is reported by the first loop.
   - (d) A block with the bytes of the demo's `src/app.ts` under the marker `apps/template/src/app.ts` is reported.
6. **Green.** The single-file command passes 6 of 6. The test runner and evaluator then re-run SKILL-AC-004 (§8 step 4).
7. **Decision entry.** Append a new entry, `DEC-0392` (the next free number; currently the last is DEC-0391), to `docs/decisions/decision-log.md`.
   - Header: Origin: ai-proposed. Status: accepted. Affects: SKILL-AC-004, DEC-0389.
   - The entry replaces DEC-0389's last sentence with: "No block may equal a non-empty `apps/demo/` file unless its marker names a file of `apps/template` or `apps/reference` that exists and that the block also equals byte for byte."
   - Give the reason: the demo is built by copying the template (DEC-0054, prompt §9 F), so unchanged template files in the demo are not evidence of derivation.
   - State the residual limit, demo code laundered through a verified app, and that the apps' `verify` and review own it.
   - Cite this record.
   - Add a one-line pointer on DEC-0389 ("Refined by DEC-0392"). Leave DEC-0389's text otherwise unchanged.

## Fix

Fixer: test-case author (prompt §8 step 3). It did not write the skill, the demo, this diagnosis or its review. Branch `claude/implement-local-cloudflare-fix-e4`, from `origin/claude/implement-local-cloudflare`. Checks follow plan §1 "Test economy" for a test-only item: typecheck, lint and the changed test.

### Red
Before any edit, `npx vitest run --config vitest.unit.config.ts tests/skill/example-copies.unit.test.ts` gave `1 failed | 5 passed (6)`, with exactly the six `block equals apps/demo/...` items of the Symptom section.

### Change (requirements 2–4 and 7)
- **`tests/skill/example-copies.unit.test.ts`, second test only.** Before the demo-equality loop, a block is skipped only when it is a verified copy. That means all of these hold:
  - its marker is present and directly adjacent;
  - the path passes the existing plain-path checks and is in `apps/template` or `apps/reference`;
  - the declared file exists;
  - `sameBytes(block, declared source)` holds.

  Every other block is still checked against every non-empty demo file, with the message `block equals <demo path>`. That covers blocks with no marker, a non-adjacent marker, an invalid or missing source, or bytes that differ from the source. The first loop, the other five tests, `support.ts`, the skill examples and all apps are unchanged. Nothing is skipped or deleted.
- **Header comment.** The bullet now reads "no block equals a file of `apps/demo/` unless it also equals its declared `apps/template`/`apps/reference` source" and cites DEC-0392 and DEC-0389.
- **`docs/decisions/decision-log.md`.** New entry DEC-0392 (ai-proposed, accepted, owner review open). It gives the replacement sentence, the reason and the residual limit, and cites this record. DEC-0389 gains only the line "Refined by DEC-0392."

### Negative controls (requirement 5)
Each control added a temporary `skill/examples/zz-control.md` holding one fenced block, ran the single-file command, then deleted the file. Nothing was committed. Afterwards `git status` showed only the intended edits.
- **(a)** Bytes of `apps/demo/src/server/access.ts` under the marker `apps/template/src/server/access.ts`. Result: `2 failed | 4 passed`.
  - Demo clause: `zz-control.md:4: block equals apps/demo/src/server/access.ts`
  - Byte-for-byte test: `zz-control.md:4: apps/template/src/server/access.ts does not exist`
- **(b)** The same bytes with no marker. Result: `2 failed | 4 passed`.
  - Demo clause: `zz-control.md:3: block equals apps/demo/src/server/access.ts`
  - Unmarked-block test: `zz-control.md:3`
- **(c)** A block under the marker `apps/demo/src/server/access.ts`. Result: `1 failed | 5 passed`.
  - First loop: `zz-control.md:4: source apps/demo/src/server/access.ts is under apps/demo/`
  - Demo clause: `zz-control.md:4: block equals apps/demo/src/server/access.ts`
- **(d)** Bytes of `apps/demo/src/app.ts` under the marker `apps/template/src/app.ts`. Result: `2 failed | 4 passed`.
  - Demo clause: `zz-control.md:4: block equals apps/demo/src/app.ts`
  - Byte-for-byte test: `zz-control.md:4: differs from apps/template/src/app.ts`

### Green (requirement 6)
- The single-file command gives `6 passed (6)`.
- `npm run lint` passes.
- `npm run typecheck` passes once the framework is built (`npm run -w packages/framework build`). Without `dist/`, three compliance e2e files cannot resolve the package. That failure is unrelated to this change.

The test runner and the evaluator re-run SKILL-AC-004 next (§8 step 4).
