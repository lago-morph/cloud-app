# fix-mig002 — decisions integrated

Integrated into `docs/decisions/decision-log.md` (section "Implementation phase: local and Cloudflare — `dev` port binding fix") by the integrator (plan §10.4). Parameter changes: none. DEC-0204's ports sentence is marked refined by DEC-0417; cli.md §2's `dev` bullet and local.md §2 are aligned.

- draft entry 1 → DEC-0417 — `dev` binds its ports itself: Vite first, then Wrangler on port 0 for the Worker and the inspector
