# Test-change review records

One record per change set that changes once-green tests (plan v0.2.0 §7a.1.9, TS-10). A test is once-green if it passed in the current session or is on `main`, in any layer: unit, integration, compliance criteria, e2e, smoke and fuzz. A change is any change to its expected results or assertions, its removal, a skip, a widened tolerance or timeout, or a changed tag.

- **Path:** `ai/implementation/test-reviews/<yyyy-mm-dd>-<item-id>.md`. A second change set of the same item on the same day adds a suffix: `<yyyy-mm-dd>-<item-id>-2.md`.
- **Who writes what:** the author of the change writes the header and the groups (`Cites:`, `Tests:`) with `Status: awaiting review`. An independent test-change reviewer subagent, which wrote neither the change nor the code, replaces that line with `Reviewer:` and adds each group's `Verdict:` and `Reasons:`. The review comes before the merge.
- **Lint:** `node scripts/lint-records.mjs <file>`, and the Claude Code commit hook (`.claude/settings.json`) on every staged record. CI does not run it (§7a.2.5).

## Format

```markdown
# Test-change review: <item-id>, <yyyy-mm-dd>

Item: <item-id>
Change set: <branch(es), PR(s) or commit range>
Author: <who made the test changes>
Reviewer: <the independent reviewer subagent>      (or, until reviewed: Status: awaiting review)

## Group: <reason-code> — <short title>
Cites: <requirement, decision or plan section; for test-was-wrong, ai/implementation/root-causes/<file>.md>
Tests:
- `<test file>` — "<test name>" — <what changed: assertion, expected result, removed, skipped, tolerance or timeout, tag>
Verdict: accepted | accepted-with-changes | rejected
Reasons:
- <why; what was sampled; any test weakened while its code stayed>
```

One group per reason; a reason may have several groups (for example two `behaviour-changed` groups citing different decisions). The reviewer judges each group as a whole and samples within it as far as the risk needs.

## Reason codes

| Code | Use when | `Cites:` |
|---|---|---|
| `code-removed` | the code the test covered is removed | required: the requirement, decision or plan section |
| `component-removed` | the whole component is removed | required: as above |
| `behaviour-changed` | the intended behaviour changed | required: as above |
| `test-was-wrong` | the test asserted the wrong thing | required: the accepted root-cause record (§7a.1.8) |
| `strengthened` | the test now checks more | optional |
| `refactor-only` | the test moved or was restructured; what it checks is unchanged | optional |

Never skip, delete or weaken a test to get a pass. A wrong test is a root-cause finding.

## What the lint checks

- The file name is `<yyyy-mm-dd>-<item-id>[-<suffix>].md`.
- `Item:` and `Change set:` are present and not empty.
- At least one `## Group: <reason-code>` section; each code is one of the six above.
- Each group has a non-empty `Tests:`; `Cites:` where the table says required; for `test-was-wrong`, `Cites:` names an `ai/implementation/root-causes/…md` record that exists in the working tree or the index.
- Either the record says `Status: awaiting review` and no group has a verdict, or every group has `Verdict:` (`accepted`, `accepted-with-changes` or `rejected`) and a non-empty `Reasons:`, and the record has `Reviewer:`.

Field labels may be bold (`**Verdict:**`). Values of `Tests:` and `Reasons:` are the inline text plus the bullet lines that follow.
