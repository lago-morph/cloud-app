# Edge cases

Read this when you are about to write the tests for a criterion, a scenario or a flow, or when you review whether a test set covers its edge cases.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.1.6 (TS-7).

## The rule

For each criterion and each scenario, the test author lists its edge cases **before** writing the tests, and covers every one that applies. Write the list where the tests' reviewer can see it: in the test file's header comment, or in the item's report. For each prompt below that does not apply, say why in a few words.

## Prompts for the list

- **Boundaries:**
  - empty;
  - one;
  - exactly at a documented limit;
  - one past it.

  Boundary tests run in-process or locally only. On a cloud, follow the cloud usage limits (`ai/implementation/plan.md` §1): one oversized row, never many rows, and no probing of platform limits.
- **Text:**
  - Unicode, case and normalisation;
  - `..`, `/` and percent-encoding in names;
  - one name that is a prefix of another. The R2 list-order defect showed this one (`ai/implementation/root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md`).
- **Order and time:**
  - sort order and paging cursors;
  - expiry at the limit, and just past it. Use a fake `Date` only, never a real wait.
- **Access:**
  - anonymous;
  - user;
  - admin;
  - another user's data.
- **Repetition:**
  - repeated requests;
  - concurrent requests;
  - reuse of single-use tokens or codes.
- **Failures:**
  - an unavailable capability (`TestApp.setUnavailable`, `docs/contracts/ts/testing.d.ts`);
  - differences between local and cloud behaviour.

## Where each case goes

- A criterion's edge cases go in the criterion's own layer.
- A flow's edge cases are also covered end to end, like its happy path and its expected errors (`SKILL.md`, rule 4).
- An input at a trust boundary with many edge cases may also be a fuzz candidate (`resources/fuzzing.md`). Fuzzing never replaces the listed example tests.

## Done

You can stop reading when every prompt above has, for your criterion or scenario, either a test or a short reason why it does not apply, and the list is where the reviewer can see it.
