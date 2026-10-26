# Releasing

What is released, together and at one version (`v<version>` tag):

| What | Where | How users get it |
| --- | --- | --- |
| `@lago-morph/prototype-framework` | npm | dependency of every app |
| `@lago-morph/create-prototype-app` | npm | `npm create @lago-morph/prototype-app@latest my-app` |
| `@lago-morph/prototype-framework-skill` | npm | the skill alone, for a cloud environment's setup script (see its README) |
| Claude Code plugin `prototype-framework` | this repository (`.claude-plugin/marketplace.json`, `skill/`) | `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph` |

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

1. Set the same version in `packages/framework/package.json`, `packages/create-prototype-app/package.json`, `packages/prototype-framework-skill/package.json`, the `@lago-morph/prototype-framework` pin in `apps/template/package.json`, and `skill/.claude-plugin/plugin.json`; run `npm install` to update `package-lock.json`.
2. **Cloudflare permissions and account setup.** If the release needs a Cloudflare permission the previous one did not, add it to `EVERYDAY` or `BOOTSTRAP` in `packages/framework/src/provision/cloudflare/permissions.ts` and raise `PERMISSIONS_VERSION` (PAR-331): `cloudflare-setup` then asks for the bootstrap token once and adds the permission to each user's everyday token in place. If it adds an account setup step or changes what one creates, raise `ACCOUNT_SETUP_VERSION` (PAR-332): setup then runs the missing steps once. Each is raised whenever a release needs more, and never lowered. Then regenerate the docs' permission tables (`npm run build -w packages/framework && node scripts/permission-tables.mjs`; a unit test fails until you do) and say in the CHANGELOG section that users must run `npm run cloudflare-setup` again.
3. In `CHANGELOG.md`, write the section and date it: `## [<version>] - YYYY-MM-DD`.
4. Check, merge to `main`, and tag:
   ```sh
   node scripts/release-check.mjs v<version>
   git tag v<version>
   git push origin v<version>
   ```
   A version with a pre-release part (`v0.2.0-rc.1`) is published under the npm dist-tag `next` and marked as a GitHub pre-release.
5. Watch the **Release** workflow in the Actions tab. Check https://www.npmjs.com/package/@lago-morph/prototype-framework shows the version with a provenance badge.

For 0.1.0, step 1 is already done; date its `CHANGELOG.md` section, do the one-time owner steps above, then tag `v0.1.0`.
