/**
 * PWD-AC-007 (docs/components/password.md §4, PWD-REQ-007): "With `NODE_ENV=test`, a sign-in, a
 * sign-up, a forgot and a reset with a forged `Origin` are each refused with 403
 * `AUTH.REQUEST_FORGERY`. The installed better-auth version equals PAR-122 exactly, and the
 * framework's source imports the library only as `better-auth/minimal` and
 * `better-auth/adapters/drizzle`. With outbound network requests recorded, sign-up and sign-in
 * make none (telemetry off)."
 *
 * In-process. Outbound requests are recorded three ways while the flow runs: `globalThis.fetch`,
 * undici's request channel, and Node's HTTP client channel. Requests to loopback addresses (the
 * local platform emulation) are not outbound.
 */
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../harness/index.js";
import { FRAMEWORK_DIR, isLocal, REPO_ROOT } from "../core/support/repo.js";
import {
  createVerifiedAccount,
  disposePasswordApps,
  expectAnswer,
  expectResult,
  forgot,
  hasLink,
  inProcessBrowser,
  linkToken,
  newAccount,
  openPasswordApp,
  par,
  reset,
  signIn,
  signUp,
  testIp,
  testPassword,
  waitForMail,
} from "./support.js";

const ALLOWED_IMPORTS = ["better-auth/minimal", "better-auth/adapters/drizzle"];
const FORGED = "https://evil.example";

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (/\.(?:ts|mts|js|mjs)$/.test(e.name) && !/\.test\.[mc]?[tj]s$/.test(e.name)) out.push(p);
  }
  return out;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isOutbound(url: string): boolean {
  try {
    const u = new URL(url);
    return !(LOOPBACK.has(u.hostname) || u.hostname.endsWith(".localhost") || u.hostname.startsWith("127."));
  } catch {
    return true;
  }
}

if (isLocal()) {
  describe("PWD-AC-007", () => {
    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await disposePasswordApps();
    });

    it(tag("PWD-AC-007", "with NODE_ENV=test, sign-in, sign-up, forgot and reset with a forged Origin are each 403 AUTH.REQUEST_FORGERY"), async () => {
      vi.stubEnv("NODE_ENV", "test");
      const b = inProcessBrowser(await openPasswordApp());
      const a = newAccount("pwd-ac-007");
      const ip = testIp();
      await createVerifiedAccount(b, a, ip);
      expectResult(await forgot(b, a.email, { ip }), "check-email");
      const token = linkToken(await waitForMail(b.mail, a.email, "reset", { accept: (m) => hasLink(m, "reset") }), "reset", b.publicOrigin);

      const other = newAccount("pwd-ac-007-forged");
      expectAnswer(await signIn(b, a.email, a.password, { ip, origin: FORGED }), 403, "AUTH.REQUEST_FORGERY");
      expectAnswer(await signUp(b, other, { ip, origin: FORGED }), 403, "AUTH.REQUEST_FORGERY");
      expectAnswer(await forgot(b, a.email, { ip, origin: FORGED }), 403, "AUTH.REQUEST_FORGERY");
      expectAnswer(await reset(b, token, testPassword(20), { ip, origin: FORGED }), 403, "AUTH.REQUEST_FORGERY");
      // Nothing took effect: the forged sign-up made no account, the forged reset left the password.
      expectAnswer(await signIn(b, other.email, other.password, { ip }), 400, "AUTH.LOGIN_FAILED");
      expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
    });

    it(tag("PWD-AC-007", "the installed better-auth is exactly PAR-122, the framework pins it exactly, and its source imports only better-auth/minimal and better-auth/adapters/drizzle"), async () => {
      const version = par.betterAuthVersion();
      const manifest = JSON.parse(readFileSync(join(FRAMEWORK_DIR, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      expect(manifest.dependencies?.["better-auth"], "packages/framework/package.json pins better-auth exactly").toBe(version);
      const installed = [join(FRAMEWORK_DIR, "node_modules", "better-auth", "package.json"), join(REPO_ROOT, "node_modules", "better-auth", "package.json")].find((p) => existsSync(p));
      expect(installed, "better-auth is installed").toBeDefined();
      expect((JSON.parse(readFileSync(installed ?? "", "utf8")) as { version?: string }).version, `${relative(REPO_ROOT, installed ?? "")}`).toBe(version);

      const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']((?:@better-auth\/|better-auth)[^"']*)["']/g;
      const imports: string[] = [];
      for (const file of await sourceFiles(join(FRAMEWORK_DIR, "src"))) {
        for (const m of (await readFile(file, "utf8")).matchAll(specifier)) imports.push(`${relative(FRAMEWORK_DIR, file)}: ${m[1] ?? ""}`);
      }
      expect(imports.length, "the framework's source imports the credential library").toBeGreaterThan(0);
      expect(imports.filter((i) => !ALLOWED_IMPORTS.includes(i.split(": ")[1] ?? "")), "imports of the library other than the allowed entry points").toEqual([]);
    });

    it(tag("PWD-AC-007", "sign-up and sign-in make no outbound network request (telemetry off)"), async () => {
      const outbound: string[] = [];
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (isOutbound(url)) outbound.push(`fetch ${url}`);
        return realFetch(input, init);
      });
      const onUndici = (message: unknown): void => {
        const req = (message as { request?: { origin?: unknown; path?: unknown } }).request;
        const url = `${String(req?.origin ?? "")}${String(req?.path ?? "")}`;
        if (isOutbound(url)) outbound.push(`undici ${url}`);
      };
      const onHttp = (message: unknown): void => {
        const req = (message as { request?: { host?: unknown; protocol?: unknown; path?: unknown } }).request;
        const url = `${String(req?.protocol ?? "http:")}//${String(req?.host ?? "")}${String(req?.path ?? "")}`;
        if (isOutbound(url)) outbound.push(`http ${url}`);
      };
      const b = inProcessBrowser(await openPasswordApp());
      subscribe("undici:request:create", onUndici);
      subscribe("http.client.request.start", onHttp);
      try {
        const a = newAccount("pwd-ac-007-telemetry");
        const ip = testIp();
        await createVerifiedAccount(b, a, ip);
        expectAnswer(await signIn(b, a.email, a.password, { ip }), 200);
        // Let any background work (mail, telemetry) run before stopping the recording.
        await new Promise((r) => setTimeout(r, 2_000));
      } finally {
        unsubscribe("undici:request:create", onUndici);
        unsubscribe("http.client.request.start", onHttp);
      }
      expect(outbound, "outbound network requests during sign-up and sign-in").toEqual([]);
    });
  });
}
