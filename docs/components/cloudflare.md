# CF — Cloudflare target

Runs an app on Cloudflare: one Worker serving the API and the static client, with D1, R2, Worker secrets, and the shared log bucket.

Contracts: none of its own. It implements the capability contracts for Cloudflare.

## 1. Requirements

#### CF-REQ-001 — Runtime shape
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-008

Each stage MUST run as one Worker that serves the API and the client's static assets from one origin (HTTP), exporting a standard `fetch` handler.

#### CF-REQ-002 — Stage resources
Origin: ai-proposed · Derives from: SYS-REQ-001, SYS-REQ-024

Each stage MUST have its own:
- D1 database;
- R2 bucket;
- R2 signing credential;
- Worker secrets.

It MUST also have a write binding to the account's shared log bucket.

#### CF-REQ-003 — Workers-compatible bundle
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-004

The Worker bundle MUST contain only Workers-compatible code. It MUST NOT include AWS SDKs, provisioning code, the Postgres harness, filesystem access, or unsupported Node.js modules.

## 2. Design

Resources are created by SST (PAR-100) through its Cloudflare components, with raw Pulumi Cloudflare resources (PAR-108) only where SST has no component. Worker settings:
- the Worker runs first for `/api` and `/api/*`;
- other paths go to static assets, with fallback to the entry page;
- the D1, R2, and log-bucket bindings;
- framework variables (CFG);
- secrets (SEC).

The stage's public origin is its `workers.dev` URL unless `publicOrigin` is configured with a custom domain.

## 3. Uses

All capability components, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CF-AC-001 | A deployed test stage serves the client and the API from one origin, and unknown API paths return JSON 404s. | CF-REQ-001 | Cloud |
| CF-AC-002 | Two stages of one app have disjoint databases, buckets, credentials, and secrets; both write to the shared log bucket. | CF-REQ-002 | Cloud |
| CF-AC-003 | Bundle inspection finds none of the excluded modules. | CF-REQ-003 | Local |
