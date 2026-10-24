# g-s2 — decisions integrated

Integrated into `docs/decisions/decision-log.md` (section "Implementation phase: AWS — phase G, offline (2026-10-24)") by G-INT (plan §10.4). Parameter changes: see that section's introduction and `docs/parameters/parameters.md`.

- draft entry 1 → DEC-0438 — The AWS stage program: components, arguments and fixed names
- draft entry 2 → DEC-0439 — The public origin comes from `router.url` in one phase
- draft entry 3 → DEC-0440 — AWS step 3: the long-lived infrastructure is `Files` and `Database`, named by literals only
- draft entry 4 → DEC-0441 — The database credentials secret: SST-created, recovery window 0, named by `$transform`
- draft entry 5 → DEC-0442 — SST's AWS state home: bootstrapped by SST; setup-account triggers it with `sst unlock`
- draft entry 6 → DEC-0443 — The Function's role trusts Lambda only (works around an SST 4.17.2 bug)
- draft entry 7 → DEC-0444 — Offline verification of the generated AWS program: type-check, Pulumi mocks, structural tests
