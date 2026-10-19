# PROV — Provisioning

Creates, updates, and removes each stage's cloud resources from a target-neutral declaration. Runs deployments end to end: checks first, then infrastructure, secrets wiring, migrations, and readiness. Also performs the one-time account setup for the shared log bucket.

Contracts: [stage-config.schema.json](../contracts/schemas/stage-config.schema.json). Commands are listed in CLI.

## 1. Requirements

#### PROV-REQ-001 — Neutral declaration
Origin: owner · Derives from: SYS-REQ-023

A stage's resources MUST be derived from the app definition alone: the fixed capability set plus the declared secrets and configuration. Apps MUST contain no infrastructure-as-code and no target-specific resource declarations.

#### PROV-REQ-002 — Deployment sequence
Origin: provenance-unclear · Derives from: SYS-REQ-012, SYS-REQ-023

`deploy` MUST perform these steps in order and stop at the first failure, exiting with failure status:
1. Check that credentials are present and usable, without printing them; that the configuration is valid; and that required secrets are set. Report every missing prerequisite by name.
2. Create or update the infrastructure.
3. Wire the resolved configuration and secret locations.
4. Apply migrations (MIG).
5. Confirm that the deployment answers a readiness request.

#### PROV-REQ-003 — Removal
Origin: provenance-unclear · Derives from: SYS-REQ-024

`remove` MUST delete all of the named stage's resources, including secrets and other values the CLI created outside the infrastructure tool. It MUST NOT touch other stages or the account-level shared resources (PROV-REQ-004).

#### PROV-REQ-004 — Account setup
Origin: owner · Derives from: SYS-REQ-021

`setup-account` MUST create the account's shared resources if they do not exist, and MUST change nothing if they do. On both clouds that is the shared log bucket; on AWS, also one network shared by all stages' databases (DEC-0074). Deployment MUST fail with a clear message if they are missing.

#### PROV-REQ-005 — Test stages
Origin: owner · Derives from: SYS-REQ-020

A stage is a test stage only when `framework.testStage` is true or `deploy --test` is used. A stage's test marking MUST NOT change after its first deployment.

#### PROV-REQ-006 — Deployment settings are configuration
Origin: owner · Derives from: SYS-REQ-023

Region and other deployment settings MUST come from the stage configuration or documented defaults (PAR-060), never from hard-coded values.

## 2. Design

SST (PAR-100) is the provisioning engine on both clouds (DEC-0036). It is driven entirely by framework code in `./provision`, which builds the SST app from the app definition, so apps never see SST. Resource lists per target are in CF-REQ-002 and AWS-REQ-003.

**Credentials.** Cloud credentials come from the environment SST normally uses. The preflight step lists which are missing, by name only.

**Errors** from these tooling commands are reported as messages with a non-zero exit status; they are not part of the runtime error catalogue.

**Stage resources** are named `<app>-<stage>-<purpose>`. App and stage name lengths (PAR-290, PAR-291) keep these within the shortest cloud resource-name limit.

**Publishing the result.** After a successful deploy, the CLI prints the public origin. For production stages, it also prints the Google callback URL to register (GOOGLE-REQ-004).

## 3. Uses

CFG, SEC, MIG, LOG, CF, AWS, CLI.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| PROV-AC-001 | The template app deploys to both clouds with no files other than its app definition, code, and configuration values. | PROV-REQ-001 | Cloud |
| PROV-AC-002 | With one credential removed, deploy names it and stops before creating anything. A failing migration stops the deploy with failure status. A clean deploy passes the readiness request. | PROV-REQ-002 | Cloud |
| PROV-AC-003 | Removing one of two stages leaves the other stage and the shared resources intact, and leaves no resource, secret, or parameter of the removed stage except its log entries. | PROV-REQ-003 | Cloud |
| PROV-AC-004 | Running `setup-account` twice changes nothing the second time. Deploying without it fails with a clear message. | PROV-REQ-004 | Cloud |
| PROV-AC-005 | Re-deploying a production stage with `--test` is refused. | PROV-REQ-005 | Cloud |
| PROV-AC-006 | A stage configured for a non-default region deploys there. | PROV-REQ-006 | Cloud |

## 5. Portability note

The neutral declaration does not change for a new target. Only a new provisioner is added, and it may use a different infrastructure tool (DEC-0019).
