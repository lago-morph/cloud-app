# Changing E2E scenarios

Read this when you add, change or retire a scenario in `docs/acceptance/e2e-scenarios.md`, or when you review such a change.

Source: `ai/implementation/plan-v0.2.0-testing-auth.md` §7a.2.3 (TS-15); `docs/CONVENTIONS.md` §2–§4.

## Who may change them

Agents keep the scenarios current with the framework's intent: whenever a flow is added or changes, its scenario changes in the same work (`SKILL.md`, rule 4). Agents may add, change and retire scenarios of any origin, with no owner approval. Each change needs:
- a decision-log entry (a draft in the item's decision file);
- a review by an independent subagent, which wrote neither the scenario text nor its tests. It checks that the text matches the framework's current intent and requirements, and that the tests carry the scenario out;
- a test-change review for every once-green test that the change or retirement changes, removes, skips or re-tags (`resources/test-change-review.md`).

## A new scenario

- **ID:** the next one after the highest ID in the file, including retired IDs. IDs are never renumbered or reused.
- **Lines under the `#### E2E-nnn — <title>` heading, in this order:**
  1. `Verifies: SYS-REQ-…`, naming the system requirements it verifies (CONVENTIONS §3);
  2. `Where: …`, naming its targets. Without it, `tests/compliance/harness/catalogue.ts` silently leaves the scenario out of the catalogue;
  3. `Origin: ai-proposed`.
- **Live-only parts** use the `(milestone)` flag, for example `Where: Local; live sign-in: cloud (milestone)`. A bare `(manual)` counts as automated.
- **Tagged tests land in the same change:** each automated part has tests tagged `[E2E-nnn]`. E2E-004's coverage part fails for an automated-tier scenario that has no tagged test.
- Each scenario covers its flow's happy path, its expected errors and its edge cases (`resources/edge-cases.md`).

## A changed scenario

- Keep its ID and its `Origin:` line.
- Change its tests in the same change, so that each automated part still has tagged tests that check the new text.
- Changing the `Where:` line moves the scenario between tiers. Check that the new text still parses: run the catalogue unit tests (`npx vitest run --config vitest.unit.config.ts tests/compliance/harness/catalogue.unit.test.ts`).

## A retired scenario

1. Remove its `#### E2E-nnn` heading and its body from the list of scenarios.
2. Add a row to the "Retired scenarios" table at the end of the file: retired ID, former scenario (its title and a one-line summary), former Where, and the reason or the replacement. The row has no `Where:` line. The catalogue adds every entry that has one, so a retired scenario left with a `Where:` line would stay expected.
3. Remove or re-tag its tests, through the test-change review.

## Done

You can stop reading when the scenario text, its `Where:` and `Origin:` lines, its tagged tests, its decision draft and its review are all in the same change, and the catalogue unit tests pass.
