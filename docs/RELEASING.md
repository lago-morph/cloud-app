# Releasing

What is released, together and at one version (`v<version>` tag):

| What | Where | How users get it |
| --- | --- | --- |
| `@lago-morph/prototype-framework` | npm | dependency of every app |
| `@lago-morph/create-prototype-app` | npm | `npm create @lago-morph/prototype-app@latest my-app` |
| `@lago-morph/prototype-framework-skill` | npm | the skill alone, for a cloud environment's setup script (see its README) |
| Claude Code plugin `prototype-framework` | this repository (`.claude-plugin/marketplace.json`, `skill/`) | `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph` |

Every release of these goes out first as one or more release candidates, `X.Y.Z-rc.N`, and then as the final `X.Y.Z` (see "Release candidates" below, DEC-0792). This applies to the framework's own packages and plugin only: apps built with the framework version and release themselves as before.

`.github/workflows/release.yml` runs on the tag: it verifies, publishes the three packages to npm with trusted publishing (OIDC, no npm token stored anywhere) and provenance, and creates the GitHub release from `CHANGELOG.md`. The plugin needs no publishing: Claude Code reads the marketplace from the repository's default branch (`main`). Why it is set up this way: `ai/implementation/decisions/distribution.md`.

## Owner steps, once

0. **Install the two workflows.** The session that prepared this could not push to `.github/workflows/` (its GitHub token lacks the `workflow` scope), so they wait in `.github/workflows-to-install/`. Move them, commit and push with your own credentials:
   ```sh
   git mv .github/workflows-to-install .github/workflows
   git commit -m "Install CI and release workflows"
   git push
   ```
1. **npm account.** Use the npm user account `lago-morph`, with two-factor authentication turned on (Account → Two-Factor Authentication). No organization is needed: the scope `@lago-morph` belongs to that user, so all three packages publish under it.
2. **First publish, by hand** (npm can configure a trusted publisher only for a package that already exists). On a clean checkout of `main` at the commit you will tag, with Node 22.22.0:
   ```sh
   npm ci
   npm run verify
   npm login
   npm publish --workspace packages/framework --access public
   npm publish --workspace packages/create-prototype-app --access public
   ```
   These two versions have no provenance; every later version does. The release workflow skips a version already on npm, so tagging this version afterwards still creates the GitHub release.
3. **Trusted publisher, for each of the three packages.** On npmjs.com open the package → **Settings** → **Trusted Publisher** → **GitHub Actions**, and enter exactly (case-sensitive): Organization or user `lago-morph`, Repository `cloud-app`, Workflow filename `release.yml`, Environment empty. Under allowed actions, allow **npm publish**. Save. Or, with npm 11.15.0 or later:
   ```sh
   npm trust github @lago-morph/prototype-framework --repo lago-morph/cloud-app --file release.yml --allow-publish
   npm trust github @lago-morph/create-prototype-app --repo lago-morph/cloud-app --file release.yml --allow-publish
   npm trust github @lago-morph/prototype-framework-skill --repo lago-morph/cloud-app --file release.yml --allow-publish
   ```
   A new trusted publisher must complete a publish within 2 days, or it expires and must be created again; if the next release is later than that, configure it just before tagging. Once a release has published through it, set **Settings → Publishing access** to require two-factor authentication and disallow tokens.

## Every release

Each release candidate and each final version goes through these steps, with its own version (`X.Y.Z-rc.N` or `X.Y.Z`); "Release candidates" below says what differs.

1. Set the same version in `packages/framework/package.json`, `packages/create-prototype-app/package.json`, `packages/prototype-framework-skill/package.json`, the `@lago-morph/prototype-framework` pin in `apps/template/package.json`, and `skill/.claude-plugin/plugin.json`; run `npm install` to update `package-lock.json`.
2. **Cloudflare permissions and account setup.** If the release needs a Cloudflare permission the previous one did not, add it to `EVERYDAY` or `BOOTSTRAP` in `packages/framework/src/provision/cloudflare/permissions.ts` and raise `PERMISSIONS_VERSION` (PAR-331): `cloudflare-setup` then asks for the bootstrap token once and adds the permission to each user's everyday token in place. If it adds an account setup step or changes what one creates, raise `ACCOUNT_SETUP_VERSION` (PAR-332): setup then runs the missing steps once. Each is raised whenever a release needs more, and never lowered. Then regenerate the docs' permission tables (`npm run build -w packages/framework && node scripts/permission-tables.mjs`; a unit test fails until you do) and say in the CHANGELOG section that users must run `npm run cloudflare-setup` again.
3. In `CHANGELOG.md`, write the section and date it: `## [<version>] - YYYY-MM-DD` (for a release candidate, see "Release candidates").
4. Check, merge to `main`, and tag:
   ```sh
   node scripts/release-check.mjs v<version>
   git tag v<version>
   git push origin v<version>
   ```
   A release candidate (`v0.2.0-rc.1`) is published under the npm dist-tag `next` and marked as a GitHub pre-release; a final version goes to `latest`.
5. Watch the **Release** workflow in the Actions tab. Check https://www.npmjs.com/package/@lago-morph/prototype-framework shows the version with a provenance badge.

## Release candidates

From v0.2.0 on, every framework release is published first as release candidates, as many as needed, and then as the final version (owner decision of 2026-11-01, DEC-0792). This covers the three npm packages and the Claude Code plugin above. It does not cover apps built with the framework: the product skill, the template's app versioning and the app release guidance are unchanged.

- **Version.** `X.Y.Z-rc.N`, where `N` is a number: 1 for the first candidate, then 2, 3, …, with no leading zeros (`rc.1`, `rc.12`; never `rc01`, `rc.01`, `rc.0` or a bare `rc`). No other pre-release form (`-beta.1`, `-RC.1`) is used. All five places of step 1 carry the full version, `rc.N` included: the template and the starter pin the framework exactly, because a range such as `^0.2.0` does not select `0.2.0-rc.1`.
- **Tag.** `vX.Y.Z-rc.N`, for example `v0.2.0-rc.1`. `node scripts/release-check.mjs v0.2.0-rc.1` refuses any other shape, and any version that differs from the tag.
- **npm dist-tag.** A release candidate is published to `next`, never to `latest`, so `npm install` and `npm create` without a version keep getting the last final release. The release workflow picks the dist-tag from the version (`release-check.mjs --npm-tag`): `next` when it contains `-rc.`, else `latest`. The GitHub release of a candidate is marked as a pre-release.
- **CHANGELOG.** One section per candidate, `## [X.Y.Z-rc.N] - YYYY-MM-DD`, newest first, holding what changed since the previous candidate (the first candidate's section holds the whole release so far). The final version gets its own `## [X.Y.Z] - YYYY-MM-DD` section above them with the complete notes for the release, gathered from its candidates; the candidates' sections stay below it as history. Each section has its link line at the bottom, as the others do.
- **Another candidate.** A fix found in `rc.N` merges to `main` as usual; then repeat steps 1–5 at `rc.N+1`. A published version is never changed or re-tagged.
- **Promote to final.** When a candidate is accepted, release the same content as `X.Y.Z`: starting from the accepted candidate's tag, change only the five versions (step 1, with `npm install` for the lockfile) and `CHANGELOG.md`, then run steps 4–5 with `vX.Y.Z`. If `main` has moved on since the candidate, make that change on a branch from the candidate's tag, tag its commit, and merge it back into `main`. The workflow publishes it to `latest`. Nothing else changes between the last candidate and the final version; if something must, it is another candidate. `next` keeps pointing at the last candidate until the next release's first candidate.
- **Trying a candidate.** A new app: `npm create @lago-morph/prototype-app@next my-app`, or with the exact version, `npm create @lago-morph/prototype-app@0.2.0-rc.1 my-app`; the app then pins that exact framework version. An existing app: `npm run upgrade -- next`, or `npm run upgrade -- 0.2.0-rc.1`. The skill package installs the same way (`@lago-morph/prototype-framework-skill@next`). The plugin follows `main`, so it shows a candidate's skill only while `plugin.json` says that candidate.

For 0.1.0, step 1 is already done; date its `CHANGELOG.md` section, do the one-time owner steps above, then tag `v0.1.0`.
