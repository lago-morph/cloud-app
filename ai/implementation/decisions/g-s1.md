# g-s1 — decisions integrated

Integrated into `docs/decisions/decision-log.md` (section "Implementation phase: AWS — phase G, offline (2026-10-24)") by G-INT (plan §10.4). Parameter changes: see that section's introduction and `docs/parameters/parameters.md`.

- draft entry 1 → DEC-0432 — One AWS SDK v3 version, 3.1153.0, for every client; client-mock and Lambda types pinned
- draft entry 2 → DEC-0433 — The HTTP Lambda sets runtime `nodejs22.x`, architecture `arm64` and memory 1024 MB explicitly
- draft entry 3 → DEC-0434 — The Lambda entry uses `hono/aws-lambda` from the pinned Hono, with one boundary cast
- draft entry 4 → DEC-0435 — The Data API adapter wraps drizzle `aws-data-api/pg` in `portableHandle` and classifies SDK errors itself
- draft entry 5 → DEC-0436 — Node-side SDK clients reach a proxy through an explicit `NodeHttpHandler` with a `proxyEnv` agent
- draft entry 6 → DEC-0437 — AWS-AC-005's wait for a paused cluster is bounded
