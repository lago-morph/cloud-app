# Changes to once-green tests

Read this when you change, remove, skip or re-tag a test that has been green once, when you are the independent reviewer of such a change, or when you list a change's test changes by reason code.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.1.9 and §7a.1.10 (TS-9, TS-10).

## What is covered

- **Once-green:** a test is once-green if it passed in the current session, or if it is on the main branch.
- **Layers:** unit, integration, compliance criteria, e2e, smoke and fuzz.
- **Changes that need review:**
  - a change to the test's expected results or assertions;
  - its removal;
  - a skip;
  - a wider tolerance or timeout;
  - a changed tag.

New tests, and edits to a test that has never been green, need no review here. The evaluator still judges them.

## Never weaken to pass

Never skip, delete or weaken a test to get a pass. If the test is wrong, that is a root-cause finding (`resources/failure-diagnosis.md`), and its change cites that record.

## The author's part

1. Group the changes by reason code. Each group cites its source:

   | Reason code | Use it when | Cite |
   |---|---|---|
   | `code-removed` | the code that the test covers is removed | the requirement, decision or plan section |
   | `component-removed` | the whole component is removed | the requirement, decision or plan section |
   | `behaviour-changed` | the intended behaviour changed | the requirement, decision or plan section |
   | `test-was-wrong` | the test checked the wrong thing | its root-cause record |
   | `strengthened` | the test now checks more, or checks more strictly | — |
   | `refactor-only` | the test moved or was restructured, and it checks the same thing | — |

2. Write the review record (below), with the groups, the files in each group, and the citations, and leave the verdicts empty.
3. Ask for the review before the change is merged. Do not merge it before the review is accepted.
4. In the item's report, list the test impact and every test change by reason code. A change with no test changes says "Test changes: none".

## The reviewer's part

The reviewer is a subagent that wrote neither the test change nor the code under test.

- Judge each group as a whole. Sample within it as far as the risk needs. For example, the unit tests of a removed module are one group with one reason, not one review per test.
- Look closely at any change where a test was weakened while the code it covers stayed the same.
- Check that each citation exists and says what the group claims.
- Give a verdict for each group: `accepted`, `accepted-with-changes` (binding on the author) or `rejected`. Mark each reason **major** or **minor**.
- On a major issue, the author answers it point by point in the record, and the group goes back to review.

## The record

- **Path:** `ai/implementation/test-reviews/<yyyy-mm-dd>-<item-id>.md`, one record per change set.
- **Content:**
  - the groups, each with its reason code, its citation and its files;
  - the verdict for each group, with its reasons.
- **Format:** `ai/implementation/test-reviews/README.md` (added by item S2) gives the exact headings, which the commit hook's test-review linter checks. Until it exists, use the content list above with one heading per group.

The evaluator checks that every change to a once-green test in its scope is covered by an accepted group.

## Done

You can stop reading when every once-green test change in your change set belongs to a group with an accepted verdict in the record, and the report lists the changes by reason code. If your change touches no once-green test, stop after "What is covered".
