# Plan: v0.2.1, the React UI profile (React SPA with Hono RPC and Tailwind), and requirements scoped by app shape

Status: draft for owner review (2026-10-31; owner decisions of 2026-10-30 applied, §3).
- **Assumes v0.2.0:** `plan-v0.2.0-auth.md` is implemented and merged. Nothing here depends on how sign-in works; the browser keeps using `getCurrentUser`, `login` and `logout` from `./client`.
- **Not breaking:** existing apps keep the current client (plain DOM TypeScript) with no change. A UI profile is opt-in per app.
- **Read first:** `docs/README.md`, `docs/CONVENTIONS.md`, `docs/components/{core,http,check,cli,skill}.md`, `docs/contracts/ts/{core,client,testing}.d.ts`, `skill/SKILL.md`, `skill/reference/http-and-validation.md`, and `apps/template/`.
- **Verified vs unverified:** §2 lists what was checked on 2026-10-31 and how. Items marked *unverified* must be checked by a spike (§10, wave 0) before anything is built on them. Don't redo the verified ones.
- **IDs:** requirement, DEC and PAR numbers below are placeholders (`U-…`). Give them the next free numbers on main when work begins, as `plan-v0.2.0-auth.md` §9 does.

## 1. Intent

Apps on the framework are written and maintained only by AI agents (SYS-REQ-006). Today the template's browser client is plain DOM TypeScript (`src/client/dom.ts`, `el()`, `textContent`). That is safe and simple, but it scales badly past a few pages: no component model, no router, no typed link between a page and the route it calls (`api<T>("/notes")` trusts the caller to pass the right `T`), and agents have far less training data for hand-rolled DOM code than for React.

v0.2.1 adds **UI profiles**: a fixed, framework-owned choice of browser stack per app, each with its own template, skill reference, examples and executable rules. One profile is added beside the existing client:

| Profile | Browser stack | Server | Client↔server contract |
|---|---|---|---|
| `react` (the default for new apps) | React SPA built by Vite, TanStack Router (code-based routes), TanStack Query, Tailwind | The app's Hono routes, unchanged in kind | **Hono RPC**: the browser's API client is typed from the server's route definitions, checked at compile time |
| `dom` (existing, unchanged) | Plain DOM TypeScript | Same | `api<T>()` |

The goals, in order:

1. **An agent can build a multi-page app and test it end to end without a browser or a cloud,** and every client↔server mismatch fails `npm run verify` at compile time.
2. **Churn can't leak in.** Each profile pins exact versions, ships wrong-vs-right rules, and enforces the dangerous ones with lint rules that app code cannot switch off (CHECK-REQ-006). Guidance comes from examples that CI type-checks and runs (SKILL-REQ-004), not from the model's memory.
3. **No framework invariant is relaxed.** One origin (HTTP-REQ-004), browser talks only to its own back end through framework helpers (SYS-REQ-008, reworded in §5.0), generated entry points (CORE-REQ-002), no raw HTML (SKILL-REQ-003), the app lib set (CHECK §2), and the same deploy pipeline.
4. **CI stays fast.** New tests don't add per-run installs or browser time where nothing the browser loads has changed (§7.5).
5. **Requirements say what the owner intends, not how the current design does it.** Requirements that encode the client/server design are reworded generally or scoped to client/server apps, so a later full-stack profile isn't blocked by wording (§5.0).
6. **The skill stays progressively disclosed:** an agent working in a `react` app reads the router, the one UI reference for its profile, and only the examples its task needs (SYS-REQ-029, SKILL-REQ-002).

Non-goals for v0.2.1: a vinext profile and any full-stack profile (server-side rendering, React Server Components, server actions; §8.3), requirements for full-stack apps (§5.0), a component library, running app browser tests in CI (§7.4), and changing the `dom` profile.

## 2. Already verified (2026-10-31). Don't redo.

### 2.1 The framework as it is on main (read from source at `1c9822b`)

- **Routes are registered imperatively.** `AppDefinition.routes: (api: Hono<AppEnv<C, S>>) => void` (`docs/contracts/ts/core.d.ts`); the template writes `api.get(…)` statements in `function noteRoutes(api: Hono<Env>): void`. Imperative registration loses the route types, so Hono RPC can't be used today (§2.2 A1).
- **The framework owns Vite completely.** `dev` calls `createServer({ configFile: false, appType: "spa", plugins: [host-check] … })` (`src/cli/dev/runtime.ts`); `deploy` calls `build({ configFile: false, root: appDir, build: { outDir } })` (`src/cli/commands/deploy.ts`, `buildClientAssets`). No app Vite configuration is read. So a React or Tailwind plugin can only be added by the framework.
- **`.tsx` is collected but can't type-check.** `collectAppFiles` and `APP_FILES` already include `.tsx` (`src/check/engine.ts`, `src/check/config.ts`), but `APP_COMPILER_OPTIONS` sets no `jsx`, so any JSX fails `verify`'s type check.
- **Browser code may not import server code, not even types.** `allowed-imports` rejects "browser code importing server or test code"; only shared code may be imported, and only with `import type` (CHECK §2). The RPC client needs the server's route type, so this needs a narrow amendment (§5.3).
- **`browser-api-only`** rejects any framework import other than `./client` and any direct `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` in browser code. It does not mention `hono/client`.
- **`no-raw-html` already covers React's `dangerouslySetInnerHTML`** (CHECK §2, DEC-0182).
- **The `api` helper's error semantics** (HTTP-REQ-006, `src/http/client.ts`): same-origin credentials; 2xx empty → `undefined`; 2xx JSON → body; a valid `ErrorResponse` → `ApiError` with its code, status and request ID; anything else → `HTTP.NETWORK_ERROR` with `response did not come from the app (status N)`; a failed fetch → `HTTP.NETWORK_ERROR`, status null, `could not reach the API`. The RPC client must keep exactly these semantics.
- **Skill mechanics:** the router is ≤ PAR-070 (8,000 bytes), each reference ≤ PAR-071 (12,000), each example ≤ PAR-072 (20,000). References are a fixed list in `src/check/references.ts` (13 files), and `tests/skill/budgets-and-links.test.ts` requires `skill/reference/` to hold exactly that list. Examples are whole files copied byte for byte from `apps/template` or `apps/reference`, each block preceded by `<!-- example-source: <path> -->`, and checked by `tests/skill/example-copies.unit.test.ts`.
- **Starter:** `packages/create-prototype-app/lib/create.mjs` copies one template directory (`templateDir`) and edits `src/app.ts` and `index.html` by exact string replacement.
- **SYS-REQ-008 (owner)** reads: "An app consists of a browser client and a server HTTP API. App browser code MUST communicate only with the app's own API and with framework-provided browser helpers." The owner's intent is logical: the browser talks only to its own back end. The wording ties it to one design (a static client plus an HTTP API), and so do CORE-REQ-001, CORE-REQ-002, HTTP-REQ-001, HTTP-REQ-006 and CHECK-REQ-001's file classification. §5.0 rewords or scopes them.
- **CI** (`.github/workflows/ci.yml`): one `verify` job on `ubuntu-24.04` with `setup-node` npm caching. It already skips Chromium unless a browser-visible path changed (any of `apps/template/`, `packages/framework/`, the browser test and its driver, `package-lock.json`), because `npx playwright install --with-deps chromium` takes about 10 minutes.

### 2.2 External facts

Checked against the npm registry, package source, a throwaway type-check project (hono 4.13.13, TypeScript 6.0.3, zod 4.6.7), the vinext repository at HEAD `76ba65f` (2026-10-30) and Microsoft's container registry.

**A. Hono RPC (hono 4.13.13, PAR-104)**
- **A1. Chaining is required.** Hono's RPC guide says to chain handlers so the types are inferred, and sub-routers must chain too (hono.dev/docs/guides/rpc). Probe: routes added through a `register(api: Hono<Env>)` callback, or as plain `api.get(…)` statements, are absent from `typeof api`; `client.notes.$get()` is a type error.
- **A2. `.route()` keeps types.** `new Hono<Env>().route("/notes", notes)` with `hc<typeof root>("/api")` types `client.notes.$get()`, `$post({ json })`, `[":id"].$put({ param, json })` and `res.json()`.
- **A3. The framework's own validator typing is enough.** A middleware typed `MiddlewareHandler<Env, string, { in: { json: z.input<S> }; out: { json: z.output<S> } }>`, which is how `jsonBody` is declared (`http.d.ts`), gives the client typed `json` input: a wrong field type and a missing `json` are both rejected. `@hono/zod-validator` is not needed.
- **A4. `hc` options.** A custom `fetch` option works (so no browser code calls `fetch`); `init` is passed through. A relative base `"/api"` works for requests, but `$url()` then throws "Invalid URL" because it calls `new URL(…)` (`hono/dist/client/client.js` line 111). So `createApiClient` uses `${location.origin}/api` as its base.
- **A5. Responses.** Non-2xx responses don't throw; `res` is a `Response`. With `c.json(body, 201)` and `c.json(err, 400)`, `if (res.status === 201)` narrows `res.json()` to that body. `InferRequestType` and `InferResponseType<…, status>` work; without a status, `InferResponseType` is the union of every body.
- **A6. `parseResponse` and `DetailedError` exist** in `hono/client` 4.13.13. `parseResponse` throws `DetailedError` on a non-ok response and returns only the non-4xx/5xx bodies. It doesn't produce `ApiError` or apply HTTP-REQ-006's rules, so the framework writes its own `call` (§5.4) and doesn't expose `parseResponse`.
- **A7. Size.** The guide warns that more routes make editors slower, and suggests chained sub-apps with exported types, matching Hono versions on both sides, and a precompiled `hcWithType`. Not needed at prototype scale (§12).

**B. React on Vite 8 (latest on npm, 2026-10-31)**

| Package | Version | Fit |
|---|---|---|
| `react`, `react-dom` | 19.3.1 | |
| `@types/react`, `@types/react-dom` | 19.3.0 | |
| `@vitejs/plugin-react` | 6.1.2 | peer `vite ^8.0.0`; Babel, React Compiler and OXC peers optional |
| `@tanstack/react-router` | 1.170.46 | peer `react >=18` |
| `@tanstack/react-query` | 5.105.0 | peer `react ^18 \|\| ^19` |
| `@testing-library/react` | 16.3.3 | needs peer `@testing-library/dom ^10` |
| `@testing-library/user-event` | 14.6.8 | |
| `jsdom` | **29.1.1**, not the latest 30.1.3 | 30.x requires Node `^22.22.2`, which the framework's Node 22.22.0 (PAR-111) doesn't meet; 29.1.1 requires `^22.13.0` |
| `eslint-plugin-react-hooks` | 7.1.1 | peer includes ESLint `^10.0.0` |
| `eslint-plugin-react` | 7.37.5 | **peer stops at ESLint `^9.7`**, so it can't join the shipped config on ESLint 10.13.0. Not needed: the framework's `no-raw-html` already covers `dangerouslySetInnerHTML` |

- Vitest 5.0.5 lists `jsdom` and `happy-dom` as optional peers and declares `"jsdom"` as a built-in environment. *Unverified:* actually running a jsdom test under `verify`'s child-process options (spike S-R4).
- *Unverified:* the exact `@testing-library/dom` 10.x version to pin (S-R4 pins it).

**C. TanStack Router codegen.** `@tanstack/router-plugin` 1.168.48 generates `routeTree.gen.ts` in Vite's `configResolved` hook, on dev and build. `@tanstack/router-cli` 1.167.46 (`tsr generate`) also works without Vite. The generated file starts with `// @ts-nocheck`, which `no-suppression-comments` (CHECK-REQ-002) would reject in app code. This is one reason §8.4 picks code-based routes.

**D. vinext (1.4.0; `@vinext/cloudflare` 1.3.0).** Not used in v0.2.1 (owner, 2026-10-30, §8.3). Kept as the record for a later full-stack decision.
- **D1. Peers:** `vite ^8.0.0`, `react`/`react-dom ^19.3.1`, `react-server-dom-webpack ^19.3.1`, `@vitejs/plugin-rsc ^0.5.37`, `@vitejs/plugin-react ^5.1.4 || ^6.0.0`, `@mdx-js/rollup ^3`. Engines `node >=22`. It targets Next.js 16.x only (README, "Design principles").
- **D2. It is an ordinary Vite plugin** in a config someone else owns: `plugins: [vinext(), cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } })]` (README, "Custom Vite configuration"; `examples/app-router-cloudflare/vite.config.ts`). `vinext({ nextConfig })` takes the Next.js config inline, and then no `next.config.*` file is read (`packages/vinext/src/index.ts`, near line 1706). vinext registers `@vitejs/plugin-rsc` itself; adding it again fails the build.
- **D3. Static export** (`output: "export"`) is supported and writes to `dist/client/`; with `trailingSlash: true` each route is `route/index.html` plus `route/index.txt` (the RSC payload), and there is a `404.html` (`examples/static-export/README.md`).
- **D4. Dynamic routes need `generateStaticParams`** in export mode; without it, or with an empty or incomplete list, the build fails: "Dynamic route requires generateStaticParams() with output: 'export'" (`packages/vinext/src/build/prerender.ts`, `static-export.ts` lines 17-18). The example puts browser-only values in the query string, read with `useSearchParams`. A client-only dynamic segment is *unverified* and looks unsupported.
- **D5. Not in export mode:** middleware, Server Actions, cookies and headers, ISR, `getServerSideProps`, request-time image optimization; App Router route handlers are skipped (`static-export.ts` line 81).
- **D6. Worker entry:** vinext's own entry is `vinext/server/fetch-handler`; a custom `worker/index.ts` can wrap it, so `/api/*` could be routed to another handler. No official example of that split.
- **D7. Agent support is thin:** the only skill (`npx skills add cloudflare/vinext`) is `migrate-to-vinext`, for migration only; `https://vinext.dev/llms.txt` returns 404; the npm package ships no docs. Next.js's bundled docs don't apply, because vinext doesn't install `next`, and they would describe Next.js, not vinext. So in this profile the framework's reference and examples are the agent's only reliable guidance.
- **D8. Testing:** vinext ships no test utilities and no testing guidance; `next/jest` is not supported and the README says to use Vitest.
- **D9. Known gaps in 1.x** (README, "Known gaps"): `use cache` works at file and function level, but `cacheComponents` and Partial Prerendering are incomplete; no build-time image or font optimization; `next/amp` and `next/web-vitals` are no-ops.

**E. Tailwind.** `tailwindcss` and `@tailwindcss/vite` are both 4.3.3; the plugin's peer range is `vite ^5.2.0 || ^6 || ^7 || ^8`, so it fits Vite 8.3.4 (PAR-113). *Unverified:* running it inside the framework's `configFile: false` dev server and client build (spike S-R5).

**F. Playwright container image.** `mcr.microsoft.com/playwright:v1.64.1-noble` exists (tag list read from the registry's `/v2/playwright/tags/list`). It matches PAR-114's Playwright 1.64.1 and the CI runner's Ubuntu 24.04 (noble). *Unverified:* its pull time on GitHub's runners against today's roughly 10-minute install, the Node version inside it, and whether `actions/setup-node` installs Node 22.22.0 in it (spike S-C1).

## 3. Owner decisions

| # | Question | Decision |
|---|---|---|
| Q1 | Which profile does `npm create` use when none is given? | **Decided (owner, 2026-10-30): `react`.** When the profile was chosen by default, the starter's closing message says so and names the alternative, `--ui dom` (plain TypeScript), and says that other profiles may be added in later releases. `dom` stays for existing apps and the framework's own tests. |
| Q2 | Ship a `vinext` profile in v0.2.1? | **Decided (owner, 2026-10-30): no.** Dropped for this release (§8.3). The research is kept in §2.2 D. |
| Q3 | Styling: plain CSS or Tailwind? | **Decided (owner, 2026-10-30): Tailwind** (§6.2). |
| Q4 | App-level browser tests? | **Decided (owner, 2026-10-30):** an opt-in local `npm run e2e`, never part of `verify` and never in CI by default (§7.4). The owner's intent: cut CI wall-clock time, including per-run installs, by not running clearly unnecessary tests in GitHub Actions; local setup costs once per session and matters much less (§7.5). |
| Q5 | Requirements that encode the client/server design? | **Decided (owner, 2026-10-30):** reword generally where the intent is shape-neutral, and scope the rest to client/server apps; no full-stack requirements until a full-stack profile is chosen (§5.0). |
| Q6 | Playwright in CI? | **Decided (owner, 2026-10-30):** run browser tests in a prebuilt Playwright container image, in their own job (§7.5). |

## 4. Architecture

```
src/
  app.ts                defineApp({ …, routes: apiRoutes })          ← server; unchanged role
  server/
    env.ts              config, secrets, type Env                    ← unchanged
    api.ts   (new)      export const apiRoutes = new Hono<Env>().route("/notes", notes)…
                        export type ApiRoutes = typeof apiRoutes      ← the ONE file browser code may `import type` from
    routes/notes.ts     export const notes = new Hono<Env>().get(…).post(…)   ← chained, so types are kept
  shared/               Zod schemas and plain types used by both sides (unchanged rules)
  client/               react: main.tsx, router.tsx, api.ts, pages/*.tsx, components/*.tsx
tests/
  app.test.ts           in-process route tests (createTestApp), unchanged
  api.test.ts  (new)    typed contract tests: createTestApiClient<ApiRoutes>(testApp)
  ui/*.test.tsx (new)   component tests in jsdom, wired to an in-process TestApp
  smoke/smoke.test.ts   unchanged: in-process under verify, against a test stage under smoke
```

At run time nothing changes: one Worker serves `/api/*` through the generated entry and everything else from static assets with SPA fallback (CF §2). The browser reaches the server only through `./client` helpers, now including a typed RPC client.

## 5. Framework changes

### 5.0 Requirements: reworded to the owner's intent, or scoped to client/server apps — U-SYS-1…3

**Why.** Several requirements describe how the current design works (a static browser client plus a Hono HTTP API) rather than what the owner intends. Read literally, they forbid any app shape except client/server, even where the intent doesn't. Each is either reworded so it states the intent for any app shape, or marked as applying to client/server apps. Requirements for full-stack apps (server-rendered pages, server components, server actions) are **not** written now: they would describe a design with no code behind it. They are written when a full-stack profile is chosen.

**New: SYS-REQ-031 — App shapes** (U-SYS-1; Origin: owner-approved, 2026-10-30)
> An app has one of the framework's supported app shapes. A **client/server app** has a browser client delivered as static assets and a back end reached by that client only through the app's HTTP API. A **full-stack app** also renders pages or runs page-initiated actions on its back end. Release 1 supports client/server apps only. A requirement marked "Applies to: client/server apps" binds only apps of that shape; every other requirement binds all shapes.

**SYS-REQ-008 — reworded** (U-SYS-2; Origin: owner, reworded 2026-10-30 to state the owner's intent; the owner confirms the exact text)
> **Browser talks only to its own back end.** An app consists of a browser client and the app's own back end, deployed together. App browser code MUST communicate only with its own back end, through framework-provided browser helpers, and MUST NOT call cloud provider services or other external services directly. Provider credentials MUST exist only on the back end. A framework browser helper MAY move file content directly between the browser and storage, provided the back end authorizes each transfer and any cross-origin configuration it needs is owned by the framework and invisible to apps.

**CORE-REQ-001 — reworded** (Origin: unchanged, owner-approved)
> **Capabilities only through the framework's context.** All back-end app code MUST obtain capabilities only through the framework's named context shapes (`Services`, `RequestVars`, and SQL's `WriteDb`), never from platform bindings, environment variables, or adapters it constructs. *(Design, not requirement: in a client/server app, HTTP handlers receive them as `c.var`.)*

**CORE-REQ-002 — reworded** (Origin: unchanged, ai-proposed)
> **One app definition; the framework owns the entry points.** An app MUST be defined by one `defineApp` call in its entry module. Every target entry point MUST be generated by the framework from that module, or wrap a framework-owned handler that it generates; app code MUST NOT construct adapters or select a target.

**Scoped to client/server apps** (U-SYS-3; each gains the line "Applies to: client/server apps (SYS-REQ-031)"; text otherwise unchanged):
- **HTTP-REQ-001** (API under `/api`; every other path serves the client's static entry page).
- **HTTP-REQ-006** (the `api` helper). The new `createApiClient`/`call` (§5.4) is also client/server only.
- **CHECK-REQ-001's classification paragraph** (`src/client/**` browser, `src/server/**` server, `src/shared/**` shared). A full-stack shape would need code that runs on both sides; it gets its own classification when chosen. The rules themselves stay general.
- **CORE §2's test-app design** (`createTestApp` drives the API in-process) is design, not a requirement, so it needs no change. Its intent, "the back end is testable in-process without a cloud", is already LOCAL-REQ-001.

**Not changed:** HTTP-REQ-004 (one origin) and SYS-REQ-006 are already shape-neutral.

**Traceability (CONVENTIONS §3):** SYS-REQ-031 needs at least one verifying criterion: U-AC-11 (§7.3). Re-check the components that depend on CORE (component map §3) for the two reworded CORE requirements; the expected result is no change, because client/server behaviour is the same.


### 5.1 Profile declaration — U-CORE-1
- The app's `package.json` carries `"prototypeFramework": { "ui": "dom" | "react" }`. Absent means `dom`. Both are client/server profiles (SYS-REQ-031).
- `dev`, `build`, `deploy`, `verify` and the portability rules read it. An unknown value fails every command with a message naming the allowed values.
- Why `package.json` and not `defineApp`: the profile is a build-time choice about the browser bundle, and `src/app.ts` is server code. Why not detect from dependencies: an explicit value can't silently change when a dependency is added.

### 5.2 Typed routes — U-CORE-2 (contract change to `core.d.ts`)
- `AppDefinition.routes` accepts either the existing callback or a Hono app value:
  ```ts
  readonly routes: ((api: Hono<AppEnv<C, S>>) => void) | Hono<AppEnv<C, S>, Schema, "/">;
  ```
  The runtime mounts a value with `root.route("/api", routes)` where it calls the callback today, after the framework middleware and framework routes, so middleware order (core.md §2) is unchanged.
- The `react` template uses the value form, built from chained sub-apps (`new Hono<Env>().get(…).post(…)`), each mounted with `.route("/notes", notes)` in `src/server/api.ts`.
- `dom` apps keep the callback; nothing changes for them.
- `no-env-access`'s ban on `onError`/`notFound` already applies to any Hono app value.

### 5.3 Browser code may import the route type from one file — U-CHECK-1 (amends CHECK-REQ-001)
- In browser code, `allowed-imports` additionally accepts exactly one import: a **type-only** import of `ApiRoutes` from `src/server/api.ts`. Any other import of server code, or a value import from that file, still fails.
- `verbatimModuleSyntax` (already in `APP_COMPILER_OPTIONS`) guarantees the import is erased.
- **Belt and braces:** `deploy`'s client build fails if any module under `src/server/` reaches the client bundle (U-CLI-3).

### 5.4 Typed API client — U-HTTP-1 (contract change to `client.d.ts`)
`./client` gains:
```ts
/** A Hono RPC client for the app's own API (`/api`), using the same request and error rules as `api`. */
export declare function createApiClient<R>(): ApiClient<R>;
/**
 * Awaits a call made with the client and returns its parsed 2xx body, typed from the route.
 * Error responses become ApiError exactly as `api` does (HTTP-REQ-006).
 */
export declare function call<T>(request: Promise<T>): Promise<SuccessBody<T>>;
```
- `ApiClient<R>` is `hc`'s client type (`hono/client`); `SuccessBody<T>` is the union of the route's response bodies for 2xx statuses (built from `InferResponseType` per status, or from `ClientResponse` directly; the spike S-R2 settles the exact type).
- Implementation: `hc<R>(`${location.origin}/api`, { fetch: frameworkFetch })` (an absolute base, because `$url()` fails on a relative one, §2.2 A4), where `frameworkFetch` adds `credentials: "same-origin"` and `Accept: application/json`. `call` reuses `api`'s response parsing (`src/http/client.ts`: `isJson`, `parseJson`, `errorResponse`), so a 2xx empty body is `undefined`, an `ErrorResponse` is `ApiError`, and anything else is `HTTP.NETWORK_ERROR` with the same messages.
- The 403 `AUTH.REQUEST_FORGERY` check is satisfied as for `api`, because requests stay same-origin.
- Thrown `FrameworkError`s are not in the route types, by design: errors arrive as `ApiError`, success bodies are typed. This matches today's model, where `api<T>` types only the success body.
- `browser-api-only` is amended to also reject value imports of `hono/client` (and `hono`) in browser code, so the typed client can only come from `./client` (U-CHECK-2). Type-only imports from `hono` stay allowed.

### 5.5 Explicit statuses in RPC routes — U-CHECK-3
- New rule `prototype-framework/json-status`: in server code of a `react` app, every `c.json(…)` call passes a literal status as its second argument (`c.json(body, 200)`).
- Why: without a status, Hono types the response with a general status, and `call`'s success type can't be narrowed to 2xx (verify in S-R2). Not applied to `dom` apps, whose template omits it.
- Diagnostic names `skill/reference/ui-react.md` (CHECK-REQ-003).

### 5.6 TSX and the profile's compiler options — U-CHECK-4
- For `react`, `APP_COMPILER_OPTIONS` gains `jsx: "react-jsx"` and `jsxImportSource: "react"`. `dom` is unchanged.
- The lib set stays ES + DOM. React's types come from `@types/react` through imports, not from a `types` array.
- Server and shared code may not contain JSX: `allowed-imports` rejects `react` and `react-dom` imports outside `src/client/**` and `tests/**`.
- The shipped configuration adds `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps` (PAR U-10, which supports ESLint 10) as errors for `react` browser code. Hook-order and stale-dependency bugs are the React mistakes agents make most often, and both are detectable statically.

### 5.7 Dev server and client build — U-CLI-1, U-CLI-2, U-CLI-3
- **`react`:** `dev` and `deploy` add `@vitejs/plugin-react` and `@tailwindcss/vite` (pinned, PAR U-1, U-7) to the framework's own Vite options. Still `configFile: false`, still SPA fallback, the host check, the `/api` proxy and no CORS. The app still has no Vite configuration.
- **The plugins are optional peer dependencies of the framework, not dependencies** (U-CLI-4). Only the `react` template lists them, at the exact pinned versions, so a `dom` app and the framework's own CI jobs that don't build a React app don't install them. The framework imports a plugin only when the profile needs it. If it isn't installed, `dev`, `deploy` and `verify` fail with a message naming the package and the exact version to add. `eslint-plugin-react-hooks` is handled the same way (PAR U-10).
- **Bundle inspection (U-CLI-3):** after the client build, fail if the client bundle contains a module from `src/server/`, from the framework's server entry (`.`), or from `./testing`, naming the module. This catches a type-only import that wasn't erased.

### 5.8 Test helpers — U-TEST-1, U-TEST-2 (contract change to `testing.d.ts`)
```ts
/** The typed API client of `createApiClient`, sending requests into a TestApp in-process. */
export declare function createTestApiClient<R>(app: TestApp): ApiClient<R>;
/**
 * For component tests: makes `./client` helpers (api, createApiClient, getCurrentUser, login, logout)
 * send their requests to `app` in-process. Returns a function that undoes it.
 */
export declare function routeClientTo(app: TestApp): () => void;
```
- `createTestApiClient` lets a test call routes through the same types the browser uses, so a renamed route or changed body fails the test file's type check (contract test).
- `routeClientTo` installs a `fetch` for the `./client` helpers only (not `globalThis.fetch`), which routes `/api/*` to `app.request`. It sends the TestApp's current identity (`as(…)`) and keeps the same-origin header the forgery check needs.
- `verify` runs tests whose first line is `// @vitest-environment jsdom` in jsdom (pinned, PAR U-8); all other tests keep Vitest's Node environment. `tests/**/*.test.tsx` is added to PAR-116's glob.

## 6. The profiles

### 6.1 `react`: React SPA + TanStack Router + TanStack Query + Hono RPC

**Template `apps/template-react/`.** The same app as `apps/template` (notes with SQL, status with KV, files, a configuration value, a secret, the admin page, the three access levels), with the same server behaviour and tests, so the two templates prove the same things. Layout:

```
index.html                 <div id="app"></div>, <script type="module" src="/src/client/main.tsx">
src/client/main.tsx        createRoot, QueryClientProvider, RouterProvider
src/client/router.tsx      code-based route tree: /, /notes, /files, /admin; beforeLoad guards use getCurrentUser
src/client/api.ts          export const client = createApiClient<ApiRoutes>()  (import type from ../server/api)
src/client/queries.ts      queryOptions per resource: notesQuery = queryOptions({ queryKey: ["notes"], queryFn: () => call(client.notes.$get()) })
src/client/pages/*.tsx     one component per route; mutations with useMutation + invalidateQueries
src/client/components/*.tsx  ErrorMessage (ApiError → code, message, request ID), Field, Layout
src/server/api.ts          apiRoutes and type ApiRoutes
src/server/routes/*.ts     chained sub-apps
tests/ui/notes.test.tsx    jsdom + Testing Library + routeClientTo(testApp)
tests/api.test.ts          createTestApiClient<ApiRoutes>
```

**Style rules the reference states (and which the lint rules enforce where marked ⚙):**
- Routes: TanStack Router, **code-based** (`createRootRoute`, `createRoute`, `createRouter`), one route tree in `router.tsx`. ⚙ No `@tanstack/router-plugin`, no file-based routing, no `react-router` (§8.4).
- Data: every server read is a `queryOptions` in `queries.ts`; route `loader`s call `queryClient.ensureQueryData`; components read with `useSuspenseQuery` or `useQuery`. Every write is a `useMutation` that invalidates the queries it affects. No `useEffect` for fetching.
- Calls: only `call(client.<path>.$<method>(…))`. ⚙ Never `fetch`, never `hono/client` directly (`browser-api-only`).
- Forms: controlled inputs; validate with the shared Zod schema's `safeParse` before sending; show the server's `HTTP.INVALID_INPUT` message on failure. No form library.
- Errors: one `ErrorMessage` component shows `ApiError.code`, `message` and the request ID, as `describeError` does today.
- HTML: ⚙ never `dangerouslySetInnerHTML` (`no-raw-html`). React escapes text children; links built from data use `<Link>` or URLs whose scheme the code checks.
- Server: route modules export a chained `new Hono<Env>()`; ⚙ every `c.json` has a status (`json-status`); guards on the route as today.
- ⚙ No Next.js or meta-framework patterns in a `react` app: `"use client"`, `"use server"`, `next/*` imports, `@tanstack/react-start`, `react-dom/server` (rule U-CHECK-5, `no-foreign-framework`). Agents drift toward these because so much React training data is Next.js.

**Dependencies (exact pins, PAR U-1…U-10, versions in §2.2 B and E):** `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `tailwindcss`; dev: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom`, `jsdom`, and the framework's optional peers `@vitejs/plugin-react`, `@tailwindcss/vite`, `eslint-plugin-react-hooks` (§5.7). `hono` moves from "server only" to also a type source for browser code (through `./client`'s types).

### 6.2 Styling: Tailwind

**What it is.** Tailwind styles elements with small predefined class names in the markup (`className="p-4 text-sm font-bold rounded"`); a build step scans the source and generates only the CSS the app uses. Chosen for its fixed design scale, which keeps agent-built pages consistent, and its large training corpus (owner, Q3).

**Shape.**
- One stylesheet, `src/client/styles.css`, whose first line is `@import "tailwindcss";`, imported once from `main.tsx`. The framework's Vite options add `@tailwindcss/vite` (§5.7).
- Components style themselves with class names. Repeated patterns become components (`Button`, `Field`, `Card` in `src/client/components/`), not `@apply` rules.
- Theme changes, if any, go in `styles.css` with `@theme`; there is no `tailwind.config.js`.

**Style rules (⚙ enforced):**
- ⚙ No `tailwind.config.{js,ts,cjs,mjs}` and no `postcss.config.*` in the app: `verify` fails and names the file, because the framework's build would ignore it (U-CHECK-6). This is also the version 3 → 4 trap: agents trained on version 3 write a config file and `@tailwind base;` directives.
- No class names assembled from strings at run time (`` `text-${color}-500` ``): Tailwind's scanner can't see them, so the styles silently go missing. Map values to whole class names instead (`const tone = { ok: "text-green-700", error: "text-red-700" }`). Stated in the reference with a wrong/right pair; not lint-enforced in v0.2.1.
- No CSS-in-JS libraries and no component library (§8.6).

## 7. Testing

### 7.1 The ladder an app agent climbs
1. **Route tests,** in-process with `createTestApp` (unchanged).
2. **Contract tests,** `createTestApiClient<ApiRoutes>(t)`: call each route through the browser's types. A changed path, input or body fails the type check of the test and of the client, before any test runs.
3. **Component tests,** jsdom + Testing Library, with `routeClientTo(t)`: render a page, type into it, click, and assert what the user sees, while the requests go through the real routes, real SQL (local D1 or PGlite), the auth mock and the error handler. This is the "end to end without a browser" layer, and it runs under `verify` on both dialects.
4. **Smoke** on a deployed test stage (unchanged, API level).

### 7.2 Framework CI (new acceptance criteria)
- Each UI template passes `verify` (as `apps/template` does now), and the root `verify` runs it.
- **Real browser for the React template:** extend `tests/skill/example-pages.test.ts`'s approach: copy `apps/template-react`, run `dev`, drive it with Playwright (PAR-114): log in with the mock, add a note, see it listed, upload a file, see the admin page as admin, and check that a Tailwind class has its style applied. Also deploy-build the client and check bundle inspection (U-CLI-3). It runs in the browser job of §7.5, beside the existing template's browser test.
- Each new rule has failing and passing fixtures (CHECK-REQ-005), including: a value import from `src/server/api.ts` in browser code (fails), a type-only one (passes), a type-only import from any other server file (fails), `hono/client` in browser code (fails), `c.json(x)` without a status in a `react` app (fails) and in a `dom` app (passes), `"use server"` and `next/headers` (fail), a `tailwind.config.js` in a `react` app (fails).

### 7.3 Acceptance criteria (placeholders; one per new requirement)
| ID | Criterion |
|---|---|
| U-AC-1 | An unknown `ui` value fails `dev`, `build`, `deploy` and `verify`, naming the allowed values. |
| U-AC-2 | An app whose `routes` is a Hono value answers the same requests, with the same middleware order, as the callback form; HTTP-AC-001…007 pass on `template-react`. |
| U-AC-3 | `call(client.x.$get())` resolves the typed body on 2xx; throws `ApiError` with code, status and request ID for an `ErrorResponse`; throws `HTTP.NETWORK_ERROR` for a 502 HTML response, a non-JSON 200 and an unreachable API, with HTTP-REQ-006's messages. Same browser test as HTTP-AC-006. |
| U-AC-4 | Renaming a route or changing its body's type in `template-react` makes `verify` fail its type check in both `src/client/` and `tests/`. |
| U-AC-5 | The client bundle of `template-react` contains no `src/server/` module; a fixture that imports a server value through a re-export fails the build. |
| U-AC-6 | A component test using `routeClientTo` sees a note created through the page in the next listing, under both dialects, and an anonymous render shows `AUTH.UNAUTHENTICATED`'s message. |
| U-AC-7 | The rule fixtures of §7.2 fail and pass as stated; every new diagnostic names an existing reference. |
| U-AC-8 | `npm create @lago-morph/prototype-app <dir> -- --ui react` (and `--ui dom`) makes an app that passes `verify`; with no `--ui` it makes a `react` app, and its output says the profile was chosen by default and names `--ui dom`. |
| U-AC-9 | The Playwright run of §7.2 passes for `template-react`, in the Playwright container image. |
| U-AC-10 | The skill tests (SKILL-AC-001…004) pass with the new references and examples, within budgets. |
| U-AC-11 | SYS-REQ-031: `prototypeFramework.ui` accepts only client/server profiles; HTTP-REQ-001 and HTTP-REQ-006 carry "Applies to: client/server apps"; the documentation link check finds every reworded and scoped requirement where §5.0 says. |
| U-AC-12 | `npm run e2e` in `template-react` runs `tests/e2e/**/*.spec.ts` against a fresh `dev` server and exits 0; without a Playwright browser installed it exits 1 with the install command; `verify` never runs these files. |
| U-AC-13 | A `dom` app's `npm install` installs none of `@vitejs/plugin-react`, `@tailwindcss/vite`, `eslint-plugin-react-hooks`; a `react` app missing one fails `dev` and `verify` naming the package and version. |
| U-AC-14 | On a pull request touching only docs or skill text, CI starts no browser job; on one touching `apps/template-react/src/client/`, the browser job runs in the Playwright image without installing a browser. |

### 7.4 `npm run e2e`: opt-in, local only (U-CLI-5)
- A new command `e2e`: builds for `local`, starts `dev` on a free loopback port with fresh local state (a temporary state directory, so it never touches the developer's `.wrangler/` data), runs Playwright (PAR-114) on `tests/e2e/**/*.spec.ts` with the app's origin as `baseURL`, then stops `dev`. Exit status is Playwright's.
- The template ships one spec, `tests/e2e/notes.spec.ts`: log in with the mock, add a note, see it listed.
- **Never part of `verify`, and never in an app's CI unless the owner adds it.** It needs a browser binary, which costs time per machine; locally that cost is once per session.
- If no Playwright browser is installed, it exits 1 and prints the install command (`npm exec --no -- playwright install chromium`). It never installs one by itself.
- The skill's testing reference says when to use it: before declaring a page change done, if a browser is available; otherwise say in the build record that it wasn't run (hard rule 8's `not-run`).
- Spec files are test code for CHECK (`tests/**`) and type-check against the test program; `*.spec.ts` doesn't match PAR-116's `*.test.ts` glob, so Vitest never collects them.

### 7.5 CI wall-clock time (U-CI-1…4)
The owner's intent: no clearly unnecessary work in GitHub Actions, including installs repeated on every run. Local setup is a much smaller concern.
- **U-CI-1, browser tests in their own job, in the Playwright image.** Move every Chromium test (the existing template's and `template-react`'s) into one job, `browser`, with `container: mcr.microsoft.com/playwright:v1.64.1-noble` (§2.2 F), so no browser or system packages are installed per run. Node 22.22.0 comes from `actions/setup-node` with npm caching inside the container (S-C1 confirms it works). The image tag moves with PAR-114, and a test asserts the tag equals the installed `@playwright/test` version.
- **U-CI-2, the job runs only when needed.** A first, cheap job computes the changed paths (today's `scope` step). `browser` runs only on a hit in: `apps/template/`, `apps/template-react/`, the framework's browser-facing code (`packages/framework/src/{client,http/client.ts,auth/client.ts,files/client.ts,cli/dev,cli/commands/dev.ts,cli/commands/deploy.ts,build}`), the browser tests and their drivers, `package-lock.json`, and the CI workflow file itself. This narrows today's `packages/framework/` match. A miss in this list is caught by the next full run on `main`, which always runs `browser`.
- **U-CI-3, the main `verify` job stays browser-free** and on `ubuntu-24.04` with `setup-node`. It now also runs `template-react`'s `verify` (component tests in jsdom are ordinary npm packages, cached, and cheap).
- **U-CI-4, measure, don't guess.** In this repository `npm ci` installs every workspace's dependencies, `template-react`'s included, so making the plugins optional peers (§5.7) helps apps, not this CI. Whether a job can install less (for example `npm ci` limited to the workspaces it runs) is measured in S-C1, and adopted only if it saves time without making the lockfile check weaker. S-C1 also records the baseline and the result: wall-clock time of a docs-only PR, a framework-server-only PR and a client PR, before and after.

## 8. Rejected alternatives

### 8.1 Next.js itself (with OpenNext)
Rejected. Next.js builds with its own toolchain and needs an adapter to run on Workers; Cloudflare itself now recommends vinext over OpenNext for new Workers apps. Using its server components and server actions would make the app a full-stack app, which release 1 doesn't support (SYS-REQ-031, §5.0). Its caching model changed in v16 and is still moving.

### 8.2 TanStack Start, React Router framework mode, RedwoodSDK, Analog
Rejected for v0.2.1. Each is a full-stack framework that owns the server entry and routing: that is, each makes a full-stack app (SYS-REQ-031). With §5.0's rewording the requirements no longer forbid that shape, but the framework has none of its pieces: request context and guards for page rendering, a test harness that renders pages, file classification for code that runs on both sides, and an entry point the framework generates around the full-stack framework's own. That is a release of its own. TanStack Start is also new (1.0 on 2026-10-13), with a thin training corpus. When a full-stack profile is chosen, TanStack Start and vinext (§8.3) are the two candidates to compare.

### 8.3 vinext (owner decision Q2, 2026-10-30: not in v0.2.1)
Researched (§2.2 D) and dropped for this release.
- **Client-only (static export)** was the only form that fits a client/server app. What it would add over the `react` profile is mostly Next.js conventions (`app/` folders, layouts, `next/link`). Its costs:
  - four spikes;
  - extra framework dependencies, including React-server packages it needs even with no server code (§2.2 D1);
  - no dynamic URL segments, because export mode needs every ID at build time (§2.2 D4), so record IDs go in query strings;
  - almost no agent material of its own (§2.2 D7), so the framework's reference would have to carry everything.
- **Server mode** (SSR, server components, server actions, its own Worker) makes a full-stack app: see §8.2.
- **What would change the decision:** a requirement for public, indexable pages, or for server rendering, which would start the full-stack profile work of §8.2, with vinext as one candidate.

### 8.4 File-based routing in the `react` profile (TanStack Router plugin)
Rejected. The plugin generates `routeTree.gen.ts` during Vite dev/build. `verify` type-checks without running Vite, so it would need the generator too, plus a rule that the committed file is fresh; and the file's naming conventions (`$id`, `_layout`, `__root`) are one more thing agents mix up between routers. Code-based routes are fully typed, explicit, and have nothing generated. The generator could run without Vite (`tsr generate`, §2.2 C), but its output starts with `// @ts-nocheck`, which `no-suppression-comments` rejects in app code, so it would also need an exemption from a type-escape rule.

### 8.5 tRPC, or OpenAPI-first with generated clients
Rejected. tRPC replaces Hono's routing with procedures, so the framework's middleware, guards, validators and error handler would need a second integration, and its URLs stop being plain REST. OpenAPI-first (`@hono/zod-openapi` + `openapi-fetch`) adds a code-generation step and a second schema style; its benefit, a language-neutral contract, isn't needed while both sides are TypeScript in one repository. Hono RPC needs no codegen and rides on the routes the framework already has. Revisit OpenAPI if a non-TypeScript client appears.

### 8.6 A component library (shadcn/ui, Radix, MUI) or CSS-in-JS
Not in v0.2.1. Each is more surface to pin and teach, and shadcn/ui copies generated component files into the app, which agents then edit by hand. Tailwind (Q3) keeps the door open: shadcn/ui is built on it, so it can be a later, separate decision. Plain CSS without Tailwind was the other option for Q3; the owner chose Tailwind for consistent styling and training data.

### 8.7 Let apps supply their own Vite configuration
Rejected. It would let app code change what the browser bundle contains, around the framework's host check, `/api` proxy and no-CORS settings (LOCAL-REQ-004, DEC-0006), and around bundle inspection. The profile list keeps every build configuration owned and tested by the framework (SYS-REQ-006).

### 8.8 Vue, Svelte, Angular profiles
Not now. React has by far the most training data and the best typed-router and query libraries; one React SPA profile, with `dom` for the smallest apps, covers what prototype apps need. Angular's CLI also refuses Vite plugins, so it can't use this build pipeline. A later profile is a new template, reference, rule list and Vite plugin, with no contract change.

### 8.9 Context7 or another docs MCP server as the churn defence
Not the primary defence. Context7's free tier is rate-limited and every lookup leaves the machine; answers come from whatever version it indexed. The framework's defence is version-locked material: exact pins, examples copied from CI-verified templates, and lint rules. The UI references may mention a docs MCP server as optional extra help for library questions the references don't cover, never as the source of the rules.

### 8.10 Smaller library choices
- **Hono's `parseResponse`** instead of a framework `call`: it throws `DetailedError`, not `ApiError`, and doesn't apply HTTP-REQ-006's rules (§2.2 A6).
- **`eslint-plugin-react`:** its peer range stops at ESLint 9, and the framework runs ESLint 10.13.0 (§2.2 B). Its one rule the framework needs, no `dangerouslySetInnerHTML`, is already `no-raw-html`.
- **happy-dom** instead of jsdom: faster, but Testing Library's documentation and most agents' examples assume jsdom, and jsdom 29.1.1 meets the Node pin.
- **The latest jsdom (30.x):** requires Node 22.22.2 or later; moving PAR-111 is a separate decision.
- **SWR, or `useEffect` + `useState` for fetching:** TanStack Query has the larger training corpus, first-class router integration (`ensureQueryData` in loaders) and explicit invalidation after writes.
- **A form library (React Hook Form):** shared Zod schemas with `safeParse` cover prototype forms, and every extra library is more surface to pin and teach.

### 8.11 A separate skill per profile
Rejected. Several skills with overlapping triggers would compete for the same requests, and the hard rules would be duplicated and drift. One router with one "UI profile" section that sends the agent to exactly one profile reference keeps progressive disclosure (SKILL-REQ-002).

### 8.12 Keep `api<T>()` and add only React
Rejected. `api<T>` trusts the caller's `T`, so a server change compiles and fails only at run time, which is the class of bug goal 1 removes. The `dom` profile keeps it.

## 9. Skill changes (U-SKILL-1…4)

- **Router (`skill/SKILL.md`, ≤ PAR-070):** add a short "UI profile" section: read `prototypeFramework.ui` in `package.json`; `react` → `reference/ui-react.md`; `dom` or absent → today's references only. Add a task-map row "Build a page; call the API from the browser; test a page". Add hard rule: "Never add a Vite configuration file, a UI framework, a router or a data library the profile doesn't list" (it would be ignored by the build or break the rules).
- **New reference** (≤ PAR-071; add it to `REFERENCE_FILES`): `ui-react.md`, covering React, the router, queries, Tailwind and the RPC client. It opens with "Read this when", then: where code goes (the §4 table for the profile); adding a page end to end (server route → `api.ts` mount → query → page → route entry → contract test → component test); the style rules of §6.1 and §6.2 with one wrong/right pair per ⚙ rule; "Check rules that send you here"; and "Stop reading when".
- **`http-and-validation.md`:** a short section on the value form of `routes` and `json-status`, pointing to the UI reference.
- **`testing.md`:** `createTestApiClient`, `routeClientTo` with the jsdom first-line comment, and `npm run e2e` (§7.4).
- **New examples** (copied byte for byte from the new templates): `react-page-and-query.md`, `react-router-and-guards.md`, `react-component-test.md`, `rpc-routes-and-client.md` (server `api.ts`, a route module, client `api.ts`, a contract test).
- **Starter:** `npm create @lago-morph/prototype-app <dir> -- --ui <profile>` picks `apps/template-react` or `apps/template`. With no `--ui`, it uses `react` and its closing message adds one line: "Made a React app (the default). Another UI profile: --ui dom (plain TypeScript)." `create.mjs`'s exact-string edits must hold for each template (add a test). `skill/scripts/scaffold` takes the same option.
- **Version-locked library guidance:** where a pinned library ships agent skills inside its npm package, the UI reference names the `node_modules/…/SKILL.md` path to read for questions the reference doesn't answer; those files move with the pinned version. TanStack ships such skills for TanStack AI through TanStack Intent. *Unverified:* whether `@tanstack/react-router` 1.170.46 and `@tanstack/react-query` 5.105.0 ship any (check `node_modules/<package>/skills/` in S-R1); if not, leave this out.

## 10. Work breakdown (parallel waves)

- **Wave 0, spikes (each writes `ai/implementation/spikes/u-<n>/RESULT.md`; stop and report to the owner if one fails):**
  - S-R1: chained sub-apps mounted with `.route()` under the framework's `/api` give `hc` full types with the framework's own `jsonBody`/`queryParams` typing, and the value form of `routes` works through `createTestApp` and `wrangler dev`.
  - S-R2: the exact `SuccessBody<T>` type; whether `json-status` is needed for 2xx narrowing; `call` + `ApiError` semantics in a browser.
  - S-R3: `@vitejs/plugin-react` inside the framework's `configFile: false` dev server and client build on Vite 8.3.4; HMR through the host check and `/api` proxy.
  - S-R4: jsdom 29.1.1 tests under `verify`'s child-process Vitest options, with `routeClientTo` and both dialects; Testing Library 16.3.3 on React 19.3.1; pin `@testing-library/dom`.
  - S-R5: `@tailwindcss/vite` 4.3.3 inside the framework's `configFile: false` dev server and client build: a utility class used in a `.tsx` file is in the built CSS, one not used isn't, and HMR updates a changed class through the host check.
  - S-C1 (CI): a `browser` job in `mcr.microsoft.com/playwright:v1.64.1-noble` runs the existing template's browser test unchanged. Record: the image's pull time, the Node version inside it, that `actions/setup-node` installs 22.22.0 and its npm cache works there, and the job's total time against today's install path. Also record whether limiting `npm ci` to the needed workspaces saves time (§7.5 U-CI-4).
- **Wave 1, in parallel:** (a) U-CORE-1/2 and the runtime mount; (b) U-HTTP-1 `createApiClient`/`call`; (c) U-CHECK-1…6 rules with fixtures, U-CHECK-4 compiler options; (d) U-CLI-1…5: Vite with the React and Tailwind plugins, optional peers, bundle inspection, `e2e`; (e) U-TEST-1/2; (f) spec and contract documents: §5.0's requirement changes (`system-spec.md`, `core.md`, `http.md`, `check.md`), then `cli.md`, `skill.md`, the `.d.ts` files, parameters and decisions; (g) U-CI-1…3, the `browser` job and its path filter, once S-C1 passes.
- **Wave 2, in parallel:** (h) `apps/template-react` with its tests and its `e2e` spec; (i) starter `--ui`; (j) skill router, reference and examples; (k) the React template's browser test in the `browser` job, and root `verify` wiring.
- **Then:** a test author for U-AC-1…14, an independent review, red-green fixes, and a CHANGELOG entry for 0.2.1 (Added: UI profiles; no breaking change).

## 11. Parameters (all `platform` pins except where noted; values in §2.2 B, E and F)

| ID | What | Value |
|---|---|---|
| U-1 | `@vitejs/plugin-react` (framework optional peer) | 6.1.2 |
| U-2 | `react`, `react-dom` | 19.3.1 |
| U-3 | `@types/react`, `@types/react-dom` | 19.3.0 |
| U-4 | `@tanstack/react-router` | 1.170.46 |
| U-5 | `@tanstack/react-query` | 5.105.0 |
| U-6 | `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom` | 16.3.3, 14.6.8, 10.x pinned by S-R4 |
| U-7 | `tailwindcss` (app dependency) and `@tailwindcss/vite` (framework optional peer) | 4.3.3 |
| U-8 | `jsdom` | 29.1.1 (30.x needs a newer Node than PAR-111) |
| U-9 | `ui` default for `npm create` (`owner`, Q1, decided 2026-10-30) | `react` |
| U-10 | `eslint-plugin-react-hooks` (framework optional peer) | 7.1.1 |
| U-11 | Playwright CI image | `mcr.microsoft.com/playwright:v1.64.1-noble`; moves with PAR-114 |

Re-check each against the registry when wave 1 starts, and take a newer patch only if it is at least two weeks old (the rule PAR-122 used).

## 12. Risks

- **Hono RPC type cost.** Large route types slow the type checker and editors. Mitigation: route modules stay small; `ApiRoutes` is one type; if `verify` time grows, split into per-area types as Hono's docs advise.
- **Tailwind version drift.** Agents trained on version 3 write config files and `@tailwind` directives. Mitigation: the ⚙ config-file rule and the reference's wrong/right pairs.
- **The narrower browser path filter misses a change** that affects the browser. Mitigation: every push to `main` runs the `browser` job.
- **React-ecosystem churn** (React majors, TanStack majors). Exact pins, `npm run upgrade` moving pins only with a framework release, and examples copied from CI-verified templates keep apps on a tested combination.
- **Agents writing Next.js idioms into `react` apps.** `no-foreign-framework` catches the imports and directives; the reference's wrong/right pairs cover the rest.
- **A type-only import that isn't erased.** `verbatimModuleSyntax` plus bundle inspection (U-CLI-3).
