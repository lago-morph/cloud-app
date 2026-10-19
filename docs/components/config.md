# CFG — Configuration

Non-secret configuration: keys declared by the app, per-stage values committed to the repository, and the framework settings that live with them (admins, login client ID, test-stage marker). Values are fixed at deploy time.

Contracts: [config.d.ts](../contracts/ts/config.d.ts), [stage-config.schema.json](../contracts/schemas/stage-config.schema.json), [errors.d.ts](../contracts/ts/errors.d.ts) (`CFG.*`).

## 1. Requirements

#### CFG-REQ-001 — Declared keys
Origin: owner · Derives from: SYS-REQ-016

An app MUST declare each configuration key it reads, with its type (string, integer, boolean, or string list) and an optional default. Reading an undeclared key MUST fail with `CFG.UNDECLARED_KEY`.

#### CFG-REQ-002 — Committed per-stage values
Origin: owner · Derives from: SYS-REQ-016

Each target and stage MUST have a committed values file conforming to the stage configuration schema. The exception is disposable test stages, which use the committed `config/<target>/test.json`. Building a deployment MUST fail when a value is missing, has the wrong type, or names an undeclared key.

#### CFG-REQ-003 — Fixed at deploy time
Origin: owner · Derives from: SYS-REQ-016

Configuration MUST be read-only at runtime and MUST change only by deploying again.

#### CFG-REQ-004 — Secret names and locations
Origin: owner · Derives from: SYS-REQ-016

The configuration resolved for a deployment MUST record each declared secret's logical name and its location on that target.

#### CFG-REQ-005 — Admin list
Origin: owner · Derives from: SYS-REQ-018

The admin list MUST be the user IDs in `framework.admins`.

#### CFG-REQ-006 — No secret values
Origin: owner · Derives from: SYS-REQ-015

Configuration files MUST NOT contain secret values; the schema provides no place for them.

## 2. Design

**Files.** Values live in `config/<target>/<stage>.json`; local development uses `config/local.json`.

**Resolution.** At deploy time, the resolved configuration combines:
- the committed values;
- the app's defaults;
- the deployment identity;
- values known only once resources exist, such as the database, bucket and log bucket identifiers, and the stage's generated public origin;
- secret locations, derived by SEC's naming convention.

**Delivery.** Committed values are embedded in the build as a generated module (DEC-0063). Provisioning-derived values reach the runtime through the platform's deployment-time settings (Worker variables on Cloudflare, Lambda environment variables on AWS). Only framework adapters read those settings; app code reads configuration through `c.var.config` only.

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
| CFG-AC-002 | Builds fail, naming the key, for a missing value, a wrong type, and an undeclared key in the values file. | CFG-REQ-002 | Local |
| CFG-AC-003 | Locally, changing a value in the committed file has no effect on a running build and takes effect only after the next build. On cloud, a deployed stage reports exactly its committed values. | CFG-REQ-003 | Local, cloud |
| CFG-AC-004 | The resolved configuration of a deployment lists every declared secret with its target location. | CFG-REQ-004 | Local, cloud |
| CFG-AC-005 | Locally, with the stub login provider, a user whose ID is added to `framework.admins` becomes admin only after the next build; removing it reverts. On cloud, a deployed stage reports exactly its committed `framework.admins`. | CFG-REQ-005 | Local, cloud |
| CFG-AC-006 | A values file containing an unknown field is rejected by schema validation. | CFG-REQ-006 | Local |

## 5. Portability note

Configuration is files plus a resolved, embedded result. A new target needs only a way to pass provisioning-derived identifiers to its runtime.
