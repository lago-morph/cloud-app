/**
 * Fuzz targets F2 and F3 (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7), on
 * the auth app's store (`store.ts`), binding (`service.ts`) and `/callback` route (`app.ts`).
 *
 * The store's SQL runs unchanged on SQLite in-process (`node:sqlite`, the engine D1 runs on)
 * behind the store's `D1Like` interface, so each case costs microseconds, not the ~10 ms of a
 * workerd D1 round trip, and the runs fit PAR-411 (DEC-0775). `store.unit.test.ts` and
 * `app.unit.test.ts` cover the same SQL on real local D1 with examples.
 */
import fc from "fast-check";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { SIGN_IN_COOKIE, handleAuthAppRequest } from "./app.js";
import { createAuthAppService } from "./service.js";
import { AUTH_APP_CODE_LIFETIME_MS } from "../auth/auth-app-binding.js";
import { createCode, ensureSchema, isRegistered, redeemCode, registerReturnUrl, saveSignIn, takeSignIn, upsertUser, validReturnUrl, type D1Like, type D1Statement } from "./store.js";

/** SQLite in memory behind the store's D1 interface; counts the statements executed. */
function sqliteD1(): { db: D1Like; executed: () => number } {
  const sqlite = new DatabaseSync(":memory:");
  let executed = 0;
  const statement = (sql: string, params: SQLInputValue[]): D1Statement => ({
    bind: (...values: unknown[]) => statement(sql, values as SQLInputValue[]),
    async first<T>() {
      executed++;
      return (sqlite.prepare(sql).get(...params) ?? null) as T | null;
    },
    async all<T>() {
      executed++;
      return { results: sqlite.prepare(sql).all(...params) as T[] };
    },
    async run() {
      executed++;
      return sqlite.prepare(sql).run(...params);
    },
  });
  const db: D1Like = {
    prepare: (sql) => statement(sql, []),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results: unknown[] = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, executed: () => executed };
}

// ---------------------------------------------------------------------------------------------
// F2: the return-URL registry matcher.
// Reason: `return` on `/start` is set by anyone; plan §4.1 step 2 requires an exact match.
// Runs: 1,000 (PAR-412). Seed: 2026103102 (DEC-0647).
// ---------------------------------------------------------------------------------------------
const F2_RUNS = 1_000;
const F2_SEED = 2026103102;

const APPS = ["notes-prod", "notes-test", "Notes-prod", "notes-prod "];
/** Canonical return URLs, as `validReturnUrl` admits them (https, or http on localhost). */
const returnUrl = fc
  .oneof(
    fc.webUrl({ validSchemes: ["https"], withQueryParameters: false, withFragments: false }),
    fc.tuple(fc.constantFrom("localhost", "127.0.0.1"), fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }), fc.webPath()).map(([h, p, path]) => `http://${h}${p === undefined ? "" : `:${p}`}${path}`),
  )
  .map((u) => (URL.canParse(u) ? new URL(u).href : ""))
  .filter(validReturnUrl);

type UrlMutation = { readonly kind: string; readonly at: number; readonly ch: string };
const urlMutation: fc.Arbitrary<UrlMutation> = fc.record({
  kind: fc.constantFrom("exact", "slash", "case", "port", "default-port", "percent", "insert", "idn", "punycode", "trailing-dot", "query", "fragment", "userinfo", "extend", "truncate", "space"),
  at: fc.nat(),
  ch: fc.constantFrom("\t", "\n", "\r", " ", "\u0000", "/", "\\", ".", "%", "@", "#", "?", ";", "A", "\u0430", "\u00e9"),
});

/** A near-miss of `url` (or `url` itself for "exact"). */
function mutateUrl(url: string, m: UrlMutation): string {
  const u = new URL(url);
  const hostAt = url.indexOf("//") + 2;
  const hostEnd = hostAt + u.host.length;
  const i = m.at % (url.length + 1);
  switch (m.kind) {
    case "slash":
      return url.endsWith("/") ? url.slice(0, -1) : `${url}/`;
    case "case": {
      const j = m.at % url.length;
      const c = url.charAt(j);
      return url.slice(0, j) + (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + url.slice(j + 1);
    }
    case "port":
      return `${url.slice(0, hostEnd)}:${(m.at % 65535) + 1}${url.slice(hostEnd)}`;
    case "default-port":
      return `${url.slice(0, hostEnd)}${u.protocol === "https:" ? ":443" : ":80"}${url.slice(hostEnd)}`;
    case "percent": {
      const j = m.at % url.length;
      return `${url.slice(0, j)}%${url.charCodeAt(j).toString(16).toUpperCase().padStart(2, "0")}${url.slice(j + 1)}`;
    }
    case "insert":
      return url.slice(0, i) + m.ch + url.slice(i);
    case "idn":
      return url.slice(0, hostAt) + u.host.replace(/a/, "\u0430").replace(/e/, "\u00e9") + url.slice(hostEnd);
    case "punycode":
      return `${url.slice(0, hostAt)}xn--${u.host}${url.slice(hostEnd)}`;
    case "trailing-dot":
      return `${url.slice(0, hostAt)}${u.hostname}.${u.port === "" ? "" : `:${u.port}`}${url.slice(hostEnd)}`;
    case "query":
      return `${url}?x=${m.at}`;
    case "fragment":
      return `${url}#x`;
    case "userinfo":
      return `${url.slice(0, hostAt)}user@${url.slice(hostAt)}`;
    case "extend":
      return url + m.ch;
    case "truncate":
      return url.slice(0, Math.max(0, url.length - 1 - (m.at % 3)));
    case "space":
      return m.at % 2 === 0 ? ` ${url}` : `${url} `;
    default:
      return url;
  }
}

const entry = fc.record({ app: fc.constantFrom(...APPS), url: returnUrl });
const probe = fc.record({ of: fc.nat(), app: fc.option(fc.constantFrom(...APPS), { nil: undefined }), mutation: urlMutation });

describe("F2: auth app return-URL registry matcher fuzz (plan §4.1 step 2, DEC-0657)", () => {
  it(`accepts a return URL only when it is byte-equal to one registered for that app (${F2_RUNS} runs, seed ${F2_SEED})`, async () => {
    const { db } = sqliteD1();
    await ensureSchema(db);
    await fc.assert(
      fc.asyncProperty(fc.array(entry, { minLength: 1, maxLength: 3 }), fc.array(probe, { minLength: 1, maxLength: 4 }), async (entries, probes) => {
        await db.batch([db.prepare("DELETE FROM registry")]);
        for (const e of entries) await registerReturnUrl(db, e.app, e.url);
        for (const p of probes) {
          const base = entries[p.of % entries.length]!;
          const app = p.app ?? base.app;
          const candidate = mutateUrl(base.url, p.mutation);
          const match = entries.find((e) => e.app === app && e.url === candidate);
          const accepted = await isRegistered(db, app, candidate);
          expect(accepted).toBe(match !== undefined);
          if (match !== undefined) expect(new URL(candidate).origin).toBe(new URL(match.url).origin);
        }
      }),
      { seed: F2_SEED, numRuns: F2_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// F3: code and `state` parsing (`/callback` query; `redeem({code, app})` over the binding).
// Reason: `code` and `state` come from the browser, and `code` again over the binding.
// Runs: 300 (S4: async store per case; 300 keeps it within PAR-411). Seed: 2026103103 (DEC-0647).
// ---------------------------------------------------------------------------------------------
const F3_RUNS = 300;
const F3_SEED = 2026103103;
const CODE_LENGTH = 43;
const APP = "notes-prod";
const RETURN = "https://notes-prod.acct.workers.dev/api/auth/callback";
const NOW = 1_800_000_000_000;
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Look-alikes of base64url characters: Cyrillic and Greek letters, digits from other scripts, dashes. */
const LOOK_ALIKES: Record<string, string> = { A: "\u0410", B: "\u0392", O: "0", "0": "\u041e", l: "1", "1": "l", I: "\u0399", "-": "\u2010", _: "\uff3f", a: "\u0430", e: "\u0435" };

type CodeMutation = { readonly kind: string; readonly at: number; readonly ch: string };
const codeMutation: fc.Arbitrary<CodeMutation> = fc.record({
  kind: fc.constantFrom("change", "truncate", "extend", "case", "pad", "look-alike", "respell-end", "whitespace"),
  at: fc.nat(),
  ch: fc.constantFrom(...B64URL, "=", "+", "/", ".", " ", "\u0000"),
});

function mutateCode(code: string, m: CodeMutation): string {
  const j = m.at % code.length;
  switch (m.kind) {
    case "change":
      return code.slice(0, j) + m.ch + code.slice(j + 1);
    case "truncate":
      return code.slice(0, j);
    case "extend":
      return code + m.ch.repeat((m.at % 3) + 1);
    case "case": {
      const c = code.charAt(j);
      return code.slice(0, j) + (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + code.slice(j + 1);
    }
    case "pad":
      return code + "=".repeat((m.at % 2) + 1);
    case "look-alike": {
      const k = [...code].findIndex((c, idx) => idx >= j && LOOK_ALIKES[c] !== undefined);
      return k < 0 ? `${code}\u0410` : code.slice(0, k) + LOOK_ALIKES[code.charAt(k)] + code.slice(k + 1);
    }
    case "respell-end":
      return code.slice(0, -1) + (B64URL[B64URL.indexOf(code.slice(-1)) ^ ((m.at % 3) + 1)] ?? "");
    case "whitespace":
      return m.at % 2 === 0 ? ` ${code}` : `${code}\n`;
    default:
      return code;
  }
}

const config = { clientId: "fuzz-client", clientSecret: "fuzz-client-secret-not-real", accountId: "fuzz-account", discoveryUrl: "https://fuzz.invalid/.well-known/openid-configuration", apiBase: "https://fuzz.invalid/client/v4", callbackUrl: "https://auth.fuzz.invalid/callback" };

describe("F3: auth app code and state parsing fuzz (plan §4.1 steps 3–4, PAR-414)", () => {
  let store: ReturnType<typeof sqliteD1>;
  let issued: string;
  /** An issued code already redeemed once, and one past its PAR-414 lifetime (PR review of #111, minor 2). */
  let used: string;
  let expired: string;
  const EXPIRED_AT = NOW - AUTH_APP_CODE_LIFETIME_MS - 1;
  const savedState = "s".repeat(CODE_LENGTH);
  beforeAll(async () => {
    store = sqliteD1();
    await ensureSchema(store.db);
    await registerReturnUrl(store.db, APP, RETURN);
    await upsertUser(store.db, { sub: "sub-a", email: "a@example.com", role: "user" }, NOW);
    issued = await createCode(store.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, NOW);
    used = await createCode(store.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, NOW);
    expect(await redeemCode(store.db, { code: used, app: APP }, NOW)).not.toBeNull();
    // Created last: `createCode` deletes codes that have expired by its own clock.
    expired = await createCode(store.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, EXPIRED_AT);
    await saveSignIn(store.db, savedState, { verifier: "v", nonce: "n", app: APP, returnUrl: RETURN, appState: "app-state" }, NOW);
  });

  it(`anything but the issued code for its app is the one refusal (null), and malformed input never reaches the store (${F3_RUNS} runs, seed ${F3_SEED})`, async () => {
    const service = createAuthAppService({ db: store.db, now: () => NOW, onError: (e) => { throw e; } });
    const candidate = fc.oneof(
      codeMutation.map((m) => ({ mutation: m })),
      fc.string({ unit: "binary", maxLength: 64 }).map((raw) => ({ raw })),
      fc.string({ unit: fc.constantFrom(...B64URL), minLength: CODE_LENGTH - 1, maxLength: CODE_LENGTH + 1 }).map((raw) => ({ raw })),
      fc.constantFrom("used" as const, "expired" as const).map((known) => ({ known })),
    );
    await fc.assert(
      fc.asyncProperty(candidate, fc.constantFrom(APP, "notes-test", "Notes-prod", ""), async (c, app) => {
        const code = "raw" in c ? c.raw : "known" in c ? (c.known === "used" ? used : expired) : mutateCode(issued, c.mutation);
        fc.pre(!(code === issued && app === APP));
        const before = store.executed();
        await expect(service.redeem({ code, app })).resolves.toBeNull();
        if (code.length > CODE_LENGTH || !/^[A-Za-z0-9_-]{43}$/.test(code)) expect(store.executed()).toBe(before);
      }),
      { seed: F3_SEED, numRuns: F3_RUNS },
    );
    // Not vacuous: the issued code was never used up, and redeems exactly once; the expired code
    // was refused only for its age (it still redeems at a time inside its lifetime).
    await expect(service.redeem({ code: issued, app: APP })).resolves.toEqual({ sub: "sub-a", email: "a@example.com", role: "user" });
    await expect(service.redeem({ code: issued, app: APP })).resolves.toBeNull();
    await expect(redeemCode(store.db, { code: expired, app: APP }, EXPIRED_AT)).resolves.toEqual({ sub: "sub-a", email: "a@example.com", role: "user" });
  });

  it(`a /callback whose state is not a saved sign-in's is a 400, never a redirect or a 5xx, and logs no code or state (${F3_RUNS} runs, seed ${F3_SEED})`, async () => {
    const logs: string[] = [];
    const deps = {
      db: store.db,
      now: () => NOW,
      log: (line: string) => logs.push(line),
      config,
      fetch: (async () => {
        throw new Error("the upstream must not be reached");
      }) as typeof fetch,
    };
    const visible = fc.string({ unit: fc.constantFrom(...B64URL, "=", ".", "%", "+", "/"), maxLength: 50 });
    const state = fc.oneof(codeMutation.map((m) => mutateCode(savedState, m)), visible, fc.string({ unit: "binary", maxLength: 50 }));
    await fc.assert(
      fc.asyncProperty(state, fc.option(fc.oneof(visible, fc.string({ unit: "binary", maxLength: 50 })), { nil: undefined }), fc.constantFrom("same", "none", "other"), async (s, code, cookieKind) => {
        fc.pre(s !== savedState);
        logs.length = 0;
        const query = new URLSearchParams({ state: s, ...(code === undefined ? {} : { code }) });
        const cookieValue = cookieKind === "same" && /^[\x21-\x3a\x3c-\x7e]*$/.test(s) ? s : cookieKind === "other" ? "x" : undefined;
        const headers: Record<string, string> = cookieValue === undefined ? {} : { cookie: `${SIGN_IN_COOKIE}=${cookieValue}` };
        const response = await handleAuthAppRequest(new Request(`https://auth.fuzz.invalid/callback?${query}`, { headers }), deps);
        expect(response.status).toBe(400);
        expect(response.headers.get("location")).toBeNull();
        for (const secret of [s, code ?? ""].filter((v) => v.length >= 8)) expect(logs.join("\n")).not.toContain(secret);
      }),
      { seed: F3_SEED, numRuns: F3_RUNS },
    );
    // Not vacuous: the saved sign-in survived every mutation of its state.
    await expect(takeSignIn(store.db, savedState, NOW)).resolves.toMatchObject({ app: APP, returnUrl: RETURN });
  });
});
