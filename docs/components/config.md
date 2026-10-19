# CFG — Configuration

Non-secret configuration: keys declared by the app, per-stage values committed to the repository, and the framework settings that live with them (admins, the optional users list, login client ID). Values are fixed at deploy time.

Contracts: [config.d.ts](../contracts/ts/config.d.ts), [stage-config.schema.json](../contracts/schemas/stage-config.schema.json), [errors.d.ts](../contracts/ts/errors.d.ts) (`CFG.*`).

## 1. Requirements

#### CFG-REQ-001 — Declared keys
Origin: owner · Derives from: SYS-REQ-016

An app MUST declare each configuration key it reads, with its type (string, integer, boolean, or string list) and an optional default. Reading an undeclared key MUST fail with `CFG.UNDECLARED_KEY`.

#### CFG-REQ-002 — Committed per-stage values
Origin: owner · Derives from: SYS-REQ-016 · Decision: DEC-0081

Each target and stage MUST have a committed values file conforming to the stage configuration schema. The exception is test stages (stages whose names start with `test-`, PROV-REQ-005), which use the committed `config/<target>/test.json`; every other stage is a production stage and needs its own committed file. Building a deployment MUST fail when a value is missing, has the wrong type, or names an undeclared key.

#### CFG-REQ-003 — Fixed at deploy time
Origin: owner · Derives from: SYS-REQ-016

Configuration MUST be read-only at runtime and MUST change only by deploying again.

#### CFG-REQ-004 — Secret names and locations
Origin: owner · Derives from: SYS-REQ-016

The configuration resolved for a deployment MUST record each declared secret's logical name and its location on that target.

#### CFG-REQ-005 — Admin list and users list
Origin: owner · Derives from: SYS-REQ-018 · Decision: DEC-0080

The admin list MUST be the user IDs in `framework.admins`. The optional users list MUST be the user IDs in `framework.users`; when it is absent, there is no users list (AUTH-REQ-003).

#### CFG-REQ-006 — No secret values
Origin: owner · Derives from: SYS-REQ-015

Configuration files MUST NOT contain secret values; the schema provides no place for them.

## 2. Design

**Files.** Values live in `config/<target>/<stage>.json`; local development uses `config/local.json` (for every local stage, DEC-PENDING-B-09-1); every test stage (`test-*`) of a cloud target shares `config/<target>/test.json`. A build for a stage not named `test-*` reads only that stage's own file and never falls back to `test.json`.

**Declared keys.** Key names are lowerCamelCase (`^[a-z][a-zA-Z0-9]*$`). A default must have the key's type. Integers are JSON numbers without a fractional part.

**Build failures.** Every problem in a values file (schema violation, missing file, missing value, wrong type, undeclared key, bad declared key or default) fails the build with one `CORE.MISCONFIGURED` error that names the file and lists every offending field or key (DEC-PENDING-B-09-2). `framework.google` is not required by the build; deploy preflight checks it for production stages (PROV-REQ-002).

**Admin and users lists.** `framework.admins` and the optional `framework.users` hold user IDs as shown by `/api/auth/me`, with the same item rules (non-empty, unique). AUTH evaluates both per request (AUTH-REQ-003). Like every value, a change takes effect at the next deploy.

**Resolution.** At deploy time, the resolved configuration combines:
- the committed values;
- the app's defaults;
- the deployment identity;
- values known only once resources exist, such as the database, bucket and log bucket identifiers, and the stage's generated public origin;
- secret locations, derived by SEC's naming convention.

The build-time result (`ResolvedConfig`, framework-internal) holds the deployment, every declared key's value, `admins`, `users` (only when present in the file), `google` (only when present), and each declared secret as `{ name, location }`. Provisioning-derived values are not part of it; the adapters that need them read them from the target's deployment-time settings (DEC-PENDING-B-09-3).

**Delivery.** Committed values are embedded in the build as a generated module (DEC-0063): a JavaScript module with no imports whose default export is the resolved configuration as JSON data. The runtime `ConfigService` is built over its `values`; reading any other key throws `CFG.UNDECLARED_KEY` naming the key. Provisioning-derived values reach the runtime through the platform's deployment-time settings (Worker variables on Cloudflare, Lambda environment variables on AWS). Only framework adapters read those settings; app code reads configuration through `c.var.config` only.

### Local
`config/local.json`, with local fixed values in place of provisioning outputs.

### Cloudflare
Embedded module plus Worker variables.

### AWS
Embedded module plus Lambda environment variables. Provisioning-derived values are small identifiers, well within Lambda's environment size limit.

## 3. Uses

CORE (deployment identity), SEC (secret location convention), PROV (provisioning-derived values).

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CFG-AC-001 | Declared keys read with their typed values and defaults; reading an undeclared key fails with `CFG.UNDECLARED_KEY`. | CFG-REQ-001 | Local |
| CFG-AC-002 | Builds fail, naming the key, for a missing value, a wrong type, and an undeclared key in the values file. A build for a stage named `test-<id>` uses `config/<target>/test.json`; a build for a stage not named `test-*` that has no committed values file of its own fails, naming the missing file, even when `test.json` exists. | CFG-REQ-002 | Local |
| CFG-AC-003 | Locally, changing a value in the committed file has no effect on a running build and takes effect only after the next build. On cloud, a deployed stage reports exactly its committed values. | CFG-REQ-003 | Local, cloud |
| CFG-AC-004 | The resolved configuration of a deployment lists every declared secret with its target location. | CFG-REQ-004 | Local, cloud |
| CFG-AC-005 | Locally, with the stub login provider, a user whose ID is added to `framework.admins` becomes admin only after the next build; removing it reverts. Likewise, adding `framework.users` without a logged-in user's ID makes that user anonymous only after the next build. On cloud, a deployed stage reports exactly its committed `framework.admins` and `framework.users`. | CFG-REQ-005 | Local, cloud |
| CFG-AC-006 | A values file containing an unknown field is rejected by schema validation. | CFG-REQ-006 | Local |

## 5. Portability note

Configuration is files plus a resolved, embedded result. A new target needs only a way to pass provisioning-derived identifiers to its runtime.
