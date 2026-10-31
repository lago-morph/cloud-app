# Test impact and changes to passing tests

Read this when a change needs new, changed or removed tests, or you are about to change, remove, skip or loosen a test that has passed before.

## Test impact of every change

Before you change code, write down its test impact and then make it, in the same work, without being asked:

- the unit and in-process tests to add, change or remove;
- the e2e tests to add, change or remove ([e2e.md](e2e.md));
- any fuzz target affected ([fuzzing.md](fuzzing.md)).

When you report to the user, list the test impact and each change to an existing test with its reason code (below).

## Changes to a once-green test

A test is **once-green** when it passed in this session or is on the app's main branch. This covers every layer: unit, in-process, e2e, smoke and fuzz.

- **What to list:** any change to its expected results or assertions, its removal, a skip (`.skip`, `.todo`, a condition that stops it running), a wider tolerance or timeout, or a renamed or merged test that checks less. List each one, grouped by reason code (below), when you report to the user.
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

A test weakened while the code it covers stayed the same needs a clear reason in the list; if you can't give one, it is a failure to diagnose ([failures.md](failures.md)).

## Examples

- [examples/tests.md](../../examples/tests.md): the template's tests, which a change set extends.

## Stopping condition

Stop reading when the change's test impact is written down and done, and every change to a once-green test is listed with its reason.
