# Owner questions — setup wizard (plan-setup-wizard.md)

Decisions the orchestrator took while the owner was away. Each is recorded as a decision with "Origin: orchestrator, pending owner review". Format: question — choice — how to reverse.

1. Batch 5 (starter, version-check, upgrade) was started alongside wave 1, not after it, because it doesn't depend on batches 1–3 — no product effect — n/a.
2. (DEC-0574) Should everyday Cloudflare commands (deploy, remove, …) receive the bootstrap token read from `.env.cloudflare`? — No: it is filtered out so it never reaches SST; one already present in the process environment is still passed through. — Remove the filter in `commandCloudflareEnvironment` (packages/framework/src/cli/cloudflare-settings.ts).
Ideas raised by agents, not implemented (out of plan scope): a note for unknown names in `.env.cloudflare` (typos); a warning when the file's mode is wider than 600.
3. (DEC-0579) The everyday token can't read the zone's DNS records (needs "DNS Read") and possibly not the Email Routing settings; how should the everyday check judge the `test-mailbox-dns` and `subaddressing` steps? — A refused read counts as done only if the setup record for the same domain lists the step; buckets, signing record, email sending and the routing rule are always read directly. — Add DNS Read (and a routing-settings read if needed) to EVERYDAY, raise PERMISSIONS_VERSION, and drop the record fallback in `setup-steps.ts` (`inspectAll`). To be checked in the live pass with a real everyday token.
