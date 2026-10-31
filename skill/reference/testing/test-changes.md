# Test impact and changes to passing tests

Read this when a change needs new, changed or removed tests, or you are about to change, remove, skip or loosen a test that has passed before, or you review such a change.

## Test impact of every change

Before you change code, write down its test impact and then make it, in the same work, without being asked:

- the unit and in-process tests to add, change or remove;
- the e2e tests to add, change or remove ([e2e.md](e2e.md));
- any fuzz target affected ([fuzzing.md](fuzzing.md)).

When you report to the user, list the test impact and each change to an existing test with its reason code (below).

## Changes to a once-green test

A test is **once-green** when it passed in this session or is on the app's main branch. This covers every layer: unit, in-process, e2e, smoke and fuzz.

- **What needs a review:** any change to its expected results or assertions, its removal, a skip (`.skip`, `.todo`, a condition that stops it running), a wider tolerance or timeout, or a renamed or merged test that checks less.
- **Who reviews:** an independent subagent that wrote neither the test change nor the code, before the change is committed.
- **Never weaken a test to pass.** A test you think is wrong is a failure to diagnose ([failures.md](failures.md)); the reason code is then `test-was-wrong`, citing the record.

## Reason codes

Group the changes and give each group one code:

| Code | When | Cite |
| --- | --- | --- |
| `code-removed` | the code or feature it tests is gone | the user's request or the change that removed it |
| `behaviour-changed` | the app's intended behaviour changed | the requirement or the user's request |
| `test-was-wrong` | the test asserted the wrong thing | its root-cause record |
| `strengthened` | it now checks more | — |
| `refactor-only` | same checks, new shape | — |

The reviewer judges each group as a whole and samples within it as the risk needs. It looks hardest at any test weakened while the code it covers stayed the same.

## The record

One record per change set: `test-records/test-changes/<yyyy-mm-dd>-<slug>.md`. For each group: the tests (file and test name), the reason code with what it cites, what changed in the assertions, and the reviewer's verdict (`accepted`, `accepted-with-changes` or `rejected`) with its reasons.

## Examples

- [examples/tests.md](../../examples/tests.md): the template's tests, which a change set extends.

## Stopping condition

Stop reading when the change's test impact is written down and done, every change to a once-green test is in a record with an accepted review, and a subagent that made none of the changes has confirmed each one is covered.
