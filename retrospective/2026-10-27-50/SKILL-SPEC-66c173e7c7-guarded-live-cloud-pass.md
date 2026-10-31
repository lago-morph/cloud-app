# Spec: `guarded-live-cloud-pass`

- **ID**: SKILL-SPEC-66c173e7c7
- **Source retrospective**: ../2026-10-27-50.md

## Intent

Run a live check of cloud provisioning code against a real account owned by someone else, through an API layer that enforces the owner's safety rules in code before any request is sent: protect the credential in use, allow token writes only on tokens the pass created, name and expire every created token, cap calls per pass and per window, stop on the first 429, redact secrets in every output, and prove cleanup by listing names against a recorded preflight baseline.

## Trigger

- Direct: "check it live on Cloudflare", "milestone live pass", "verify on the real account".
- Proactive: code that creates, updates or deletes API tokens or account resources is about to merge, and the environment holds a real account token.
- Do not use when no real credential is present (use the fake API), or when the owner hasn't authorised live calls.

## Inputs

- Environment credentials (for Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; Node needs `NODE_USE_ENV_PROXY=1` behind the sandbox proxy).
- The owner's limits: name prefix and expiry for created tokens, calls per pass and per window, database read/write budgets, and resources that must remain.
- The list of exercises (which code paths to run live).

## Outputs

- `ai/implementation/spikes/live-<name>/guarded-api.ts` with unit tests against a fake fetch.
- `preflight.md`: the redacted baseline, made of read-only calls only.
- `live-pass-<date>.md`: per-exercise outcome, exit code, redacted key lines, call counts and cleanup proof.
- A defect list (file:line) for the orchestrator. The pass never fixes production code itself.

## Workflow

1. Build the layer first, with these rules enforced before every send:
   - Read the credential's own token ID once (`GET /accounts/{id}/tokens/verify`) and add it to the protected IDs.
   - Normalise the path exactly as the URL parser will send it (`new URL(base + path).pathname`, decoding each segment) before matching.
   - Allow PUT, PATCH or DELETE on a token ID only for tokens this pass created. A token create must use the required name prefix and an expiry no more than N hours away.
   - Count every call, including HEAD reachability probes, against the per-pass and per-window limits. After any 429, refuse every later call.
   - Redact token values, account and zone IDs, the subdomain, and any 32-hex string from every output.
2. Unit-test every guard against a fake fetch, including bypass spellings: `..`, `\`, tabs, `%2e`, case.
3. Preflight: read-only calls only. Record the credential status (valid, expiry yes/no; never the ID), the count of leftover prefix-named tokens, resource names and the setup-record state.
4. Run each exercise through the product's own entry points, never reimplemented calls, with the layer injected as its API client and the owner's token ID in the product's protected list.
5. Clean up: delete only prefix-named tokens, list token names again, and compare resource names with the preflight.
6. Grep the evidence for the real values (counts only) before committing it.

## Concrete examples

**Example 1: the protected bootstrap stand-in.** The owner's admin token stood in for the bootstrap token. The first design let setup try the self-delete and relied on the guard to refuse it. The refusal reached setup's top-level catch, so every live run exited 1. The fix made setup skip the delete, with a note, when the bootstrap ID is protected; both guards still refuse it. With that fix the live runs exited 0, and no DELETE was ever sent for that ID.

**Example 2: preflight finding.** Seven GETs showed that the account's setup record existed but lacked `setupVersion`. So the first live run would take the "out of date" path, not "nothing to do". That was recorded as an owner question before any write happened.

## Anti-patterns

- A guard that compares raw path strings: `x/../tokens/<id>` bypasses it.
- A deny-list of forbidden IDs instead of an allow-list of created ones: a bug could still delete the owner's other tokens.
- Exempting HEAD probes from the budget: they kept being sent after a 429.
- A driver that calls internals with different inputs: it wrote `frameworkVersion: "unknown"` to the real record.
- Pasting proxy diagnostics into evidence: the status endpoint lists real hostnames in clear text.

## Acceptance criteria

- Guard unit tests cover every bypass form and pass.
- The evidence contains 0 real secrets or IDs (checked by grep).
- After cleanup, no prefix-named tokens remain and resource names equal the preflight's.
- The protected credential receives no write request.
- Calls used are reported per exercise and stay within the budgets.

## Files this skill creates / modifies

- `ai/implementation/spikes/live-<name>/guarded-api.ts`, `*.unit.test.ts`, `vitest.config.ts`, `tsconfig.json`: the layer and its tests.
- `ai/implementation/spikes/live-<name>/preflight.md`, `live-pass-<date>.md`: redacted evidence.
- Driver scripts in the same folder.
