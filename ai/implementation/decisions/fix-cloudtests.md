# fix-cloudtests — decisions integrated

Integrated into `docs/decisions/decision-log.md` (section "Implementation phase: local and Cloudflare — Cloudflare live testing (2026-10-23/24)") by the integrator (plan §10.4). Parameter changes: none.

- draft entry 1 → DEC-0423 — The MIG criteria run as three self-contained blocks, and set the secret after the first Cloudflare deploy
- draft entry 2 → DEC-0424 — Every further cloud stage takes the shared stage guards, and releases the lock on every failure path
- draft entry 3 → DEC-0425 — A removal made by another actor cancels the cleanup removal only when nothing is left
- draft entry 4 → DEC-0426 — The MIG Cloudflare stage reads the D1 listing once per deploy, and `snapshot()` batches its SELECTs
