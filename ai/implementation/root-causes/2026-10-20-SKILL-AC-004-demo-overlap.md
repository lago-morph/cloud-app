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
