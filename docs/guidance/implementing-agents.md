# Guidance for Agents Implementing the Framework

Working rules for AI agents that build or change the framework itself. They are not requirements of the framework, and they do not govern agents that build apps on the framework (those follow the skill).

Each rule carries its origin (see [CONVENTIONS.md §4](../CONVENTIONS.md)). Rules marked `provenance-unclear` came from an earlier AI-written implementation prompt (DEC-0047); follow them unless they conflict with a requirement, a contract, or an owner instruction.

## Sources of truth

| Rule | Origin |
| --- | --- |
| `docs/` is authoritative. Do not use files under `ai/spec/` as a source of requirements or design; they are superseded and will be deleted (DEC-0046). | owner |
| Only identified requirements and contract files are binding; design text may be deviated from with a decision-log entry ([CONVENTIONS.md §1](../CONVENTIONS.md)). | owner-approved |
| Record every important assumption or deviation in the documents (decision log, parameters register, or the relevant component document), never only in chat or memory. | provenance-unclear |
| Platform observations recorded from earlier work are unverified hypotheses (DEC-0050). Reproduce them before relying on them. | provenance-unclear |

## Working practice

| Rule | Origin |
| --- | --- |
| Commit and push to the feature branch frequently. Sandboxes are ephemeral; work held only in a sandbox can be lost. | owner |
| Don't over-engineer. Prefer the simplest design that meets the requirements (SYS-REQ-007). | owner |
| Work in the existing checkout and preserve existing user work and configuration. Do not create additional worktrees unless asked. | provenance-unclear |
| Follow the implementation plan's order once one exists, and validate the riskiest platform mechanisms early, before polishing later work. | provenance-unclear |
| Once the required checks pass, do not broaden into unrelated features or test suites. | provenance-unclear |
| The app-agent rule "report framework defects instead of working around them" does not apply to agents implementing the framework; they inspect and fix framework source. | provenance-unclear |

## Failures and honesty

| Rule | Origin |
| --- | --- |
| When something does not work: read the output, test a diagnosis, apply a supported fix, rerun. Do not suppress failures, loosen assertions, weaken contracts, disable verification, or describe an untested fallback as working. | provenance-unclear |
| If a pinned dependency cannot satisfy a requirement: diagnose it, record a justified replacement in the parameters register, and rerun the affected acceptance criteria. | provenance-unclear |
| Never perform a destructive data operation (such as dropping and recreating tables) as a substitute for a migration mechanism that does not work. Report the blocker instead. | provenance-unclear |
| Keep TLS, checksum, and signature verification enabled throughout troubleshooting. | provenance-unclear |
| Report results with explicit statuses (`passed`, `failed`, `blocked`, `skipped`, `unrun`), and keep facts confirmed from documentation separate from executed results. | provenance-unclear |
| None of these count as proof that a capability works: a listening port, a list of deployed resources, a run with zero tests, source inspection, or a local result offered as cloud evidence. | provenance-unclear |

## Cloud accounts, credentials, and cost

| Rule | Origin |
| --- | --- |
| Do all local and independent work first. Check that required cloud credentials are present and usable without revealing their values, and list any missing prerequisites precisely. | provenance-unclear |
| Never invent credentials. Never ask for secret values in chat; secrets are supplied outside committed files. | provenance-unclear |
| For local development, generate development-only signing secrets in ignored local files if they are absent; never overwrite existing ones. | provenance-unclear |
| Cloud provisioning costs money. Use only the accounts and permissions authorized for the task. Document retained costs, teardown behavior, and setup steps in the README. | provenance-unclear |
| Always attempt teardown of cloud test stages you create; remove only resources you created; report anything left behind; preserve the original failing exit status if cleanup also fails. | provenance-unclear |
| When blocked by a missing external prerequisite: finish all independent work, name the prerequisite and the affected checks, and never report a blocked check as passed. | provenance-unclear |
| Do not publish packages to a public registry. | provenance-unclear |

## Final reports

| Rule | Origin |
| --- | --- |
| A final report states what was delivered, which checks actually ran and their results, known limits, and blockers. A target with unrun or failed checks is never described as complete. | provenance-unclear |
