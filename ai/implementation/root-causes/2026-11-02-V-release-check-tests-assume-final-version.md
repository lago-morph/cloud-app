# Root cause: at version 0.2.0-rc01, three `tests/release-check.unit.test.ts` cases fail because they build their "final version" from the repository's own version

Status: accepted

## Symptom

On branch `v0.2.0/release-rc01` (commit `8cdf55f`), after the five places of `docs/RELEASING.md` step 1 were set to `0.2.0-rc01`, `npm run test:unit` fails 3 of 2925 tests, all in `tests/release-check.unit.test.ts`:

- "accepts the matching tag with a dated CHANGELOG section and returns its notes": `expect(r.prerelease).toBe(false)` received `true` (line 51);
- "publishes a final version to the dist-tag latest": expected `{ prerelease: false, npmTag: "latest" }`, received `{ prerelease: true, npmTag: "next" }` (line 85);
- "marks a version with a pre-release part as a prerelease": expected `true`, received `undefined` (line 99).

The release workflow's `verify` job runs `npm run test:unit`, so a tag `v0.2.0-rc01` on this content would stop before publishing. The script itself is right: `node scripts/release-check.mjs v0.2.0-rc01` passes, `--npm-tag` prints `next`.

## Evidence

1. The file alone, `npx vitest run --config vitest.unit.config.ts tests/release-check.unit.test.ts`: 3 failed, 5 passed, the same three cases and messages.
2. The three cases take their version from the repository: `const fwVersion = JSON.parse(readFileSync("packages/framework/package.json")).version` (line 29). `fixture()` copies the five version-bearing files as they are in the repository, so the fixture's versions are `fwVersion` too.
3. Case 1 checks tag `v${fwVersion}` and expects `prerelease: false`; case 2 expects `npmTag: "latest"`. With `fwVersion = "0.2.0-rc01"`, `check()` correctly returns `prerelease: true` (`version.includes("-")`) and `npmTag: "next"` (`/-rc\d\d$/`), as DEC-0792 requires.
4. Case 3 checks tag `v${fwVersion}-rc01`, which is `v0.2.0-rc01-rc01`. That does not match `TAG`, so `check()` returns only `{ problems: [...] }`, and `prerelease` is `undefined`.
5. **Experiment** (reverted): set the same five places to the final version `0.2.0` and re-run the file: 8 passed. Restored to `0.2.0-rc01`; `git status` clean.
6. The cases were written on 2026-11-02 (`cc1d4cf`, `835f628`, DEC-0792) while the repository was at the final version `0.1.1`, so they passed then and on `main`.
7. The same class of defect was found and fixed at the 0.1.1 bump: `node-deps.unit.test.ts` compared with a hard-coded 0.1.0 (`9264e52`).

## Causal chain

1. DEC-0792 makes every release start as `X.Y.Z-rcNN`, so the repository's version is now a release candidate (evidence 3, symptom).
2. Three cases assume the repository's version is a final `X.Y.Z` with no pre-release part (evidence 2, 3, 4).
3. So, at any candidate version, cases 1 and 2 get a correct pre-release answer where they expect a final one, and case 3 builds an invalid tag (evidence 3, 4). At a final version they pass (evidence 5, 6).

## Alternatives ruled out

- *`release-check.mjs` is wrong.* Its answers for `0.2.0-rc01` (prerelease, `next`) are what DEC-0792 and `docs/RELEASING.md` require, and the script passes on the real repository (symptom). The candidate cases that build their own versions with `setVersions` (`0.2.0-rc01`, `rc12`, `rc99`) pass.
- *The version bump is wrong.* All five places say `0.2.0-rc01` and the case "the repository's versions all agree" passes.
- *Load or timing.* The failure reproduces with the file alone (evidence 1) and is deterministic (evidence 5).

## Proposed fix

Test-only, reason code `test-was-wrong`. In the three cases, stop depending on the repository's version: set the fixture's files to a fixed final version with the existing `setVersions` helper (for example `setVersions(dir, "1.2.3")`) and use that version in the CHANGELOG heading and the tag (`v1.2.3`; case 3 `v1.2.3-rc01` against files that say `1.2.3`). The expected results stay as they are: a final version is not a prerelease and goes to `latest`; a tag with `-rc01` is a prerelease. No assertion is weakened. The case "the repository's versions all agree" keeps using the repository.

## Verification plan

- Red: the three cases fail now at `0.2.0-rc01` (evidence 1).
- Green: after the fix, `tests/release-check.unit.test.ts` passes 8/8 at `0.2.0-rc01`, and again with the five places set temporarily to `0.2.0` (the final version this release will be promoted to), then restored.
- `npm run test:unit` passes in full.

## Review

Status: accepted

Reviewer: the independent root-cause reviewer (a subagent that neither diagnosed this failure nor wrote the script or its tests), 2026-11-02, on `5b0fd54` in a separate worktree. Every experiment below was reverted, and nothing but this section and the Status line was changed.

**Verdict: accepted.**
1. **Reproduced.** The file alone at `0.2.0-rc01` gives 3 failed and 5 passed, with the three messages at lines 51, 85 and 99 as quoted. `node scripts/release-check.mjs v0.2.0-rc01` prints `ok (prerelease)`, and `--npm-tag` prints `next`. Evidence 5 holds: with the five places set to `0.2.0`, all 8 cases pass. Evidence 6 and 7 hold: `cc1d4cf`, `835f628` and `9264e52` exist, and `main` is at `0.1.1`.
2. **Every link is supported by the code.**
   - `fwVersion` is read from `packages/framework/package.json`, and `fixture()` copies the five files unchanged.
   - `check()` returns `prerelease: version.includes("-")` and `npmTag` `next` for `/-rc\d\d$/`.
   - `TAG` rejects `v0.2.0-rc01-rc01`, so case 3 gets only `{ problems }`.
3. **The script is right and the tests are wrong.**
   - `docs/RELEASING.md` "Release candidates" and DEC-0792 require exactly what the script does: `rcNN` versions are prereleases published to `next`, and a tag has at most one `-rcNN`.
   - The three cases are about a final version (cases 1 and 2) and about a single `-rc01` suffix (case 3). The repository being at a candidate breaks their premise, not the script's behaviour.
   - The other alternatives (the version bump, load or timing) are ruled out with evidence.
4. **The fix keeps every assertion's strength.** I applied it in a scratch copy: `setVersions(dir, "1.2.3")`, CHANGELOG `[1.2.3]`, tags `v1.2.3` and `v1.2.3-rc01`, with every `expect` unchanged. The file then passes 8/8 at `0.2.0-rc01`.
   - Mutation checks against the fixed file: forcing `prerelease: true` fails cases 1 and 2; forcing `prerelease: false` fails case 3 and the candidate case; forcing `npmTag` to `next` for every version fails case 2.
   - The fixed cases therefore still catch every regression the originals could catch at a final version, and they no longer depend on the repository's version.
   - Case 3 keeps its intent: files at `1.2.3` against tag `v1.2.3-rc01` mismatch on purpose, and the classification still holds.
5. **Minor, for the fixer.**
   - Under rule 8, list the three cases as `test-was-wrong`, citing this record.
   - Case 1 should keep its CHANGELOG link line, using `[1.2.3]: …`, so the notes-boundary check is unchanged.
