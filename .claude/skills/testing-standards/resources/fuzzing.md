# Fuzzing

Read this when you consider adding a fuzz target, write or change one, review the fuzz target list, or handle a failure found by fuzzing.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.1.7 (TS-8).

## Where to fuzz

Choose targets one by one, and only where fuzzing finds what example tests would miss:
- parsers, validators and encoders at a trust boundary: names, cursors, redirect and return URLs, codes and tokens, and request bodies;
- especially code with repeated regressions, judged from its root-cause records in `ai/implementation/root-causes/`.

Having a contract or a schema makes an interface eligible, not required. The target list stays short, and a reviewer confirms that each entry is justified. The v0.2.0 list, with each target's trust boundary, root-cause evidence, run count and seed, is `ai/implementation/v0.2.0-coverage-fuzz.md` (item S4). A target that is not on the list needs the same justification and review before it is added.

Never fuzz every endpoint or every API.

## How much

- Each fuzz target keeps its run small.
- The test states its run count and its fixed seed, each with a one-line reason.
- Fuzz targets run in the normal unit or integration layer, and add only seconds to it.
- No long or exhaustive runs.

## Local only

Fuzzing runs in-process or against the local `dev` server. It never runs against a cloud stage (`ai/implementation/plan.md` §1, cloud usage limits).

## Findings

- A failure found by fuzzing goes through `resources/failure-diagnosis.md` like any other failure.
- Its failing input becomes a plain example regression test, which stays even if the fuzz target changes.

## Tool

The tool must run offline in Node, so that apps need no other toolchain. Its choice is recorded in the decision log. Use the recorded tool. If none is recorded yet, choose one that meets this rule and record it with a decision-log entry. Do not add a second one without a new decision.

## Done

You can stop reading when your target is on the reviewed list (or you decided not to fuzz), its test states its run count and seed with reasons, it runs locally only in the unit or integration layer, and any finding has a root-cause record and a regression test.
