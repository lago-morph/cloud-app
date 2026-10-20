/**
 * SEC-AC-002: a scan of the repository, the build output, the deployed browser assets, the
 * stored log entries, and error responses from a test run finds no test secret value. The stored
 * log entries also contain no test session cookie value and no issued ticket URL; locally, they
 * also contain no stub login provider authorization code (docs/components/secrets.md §4).
 *
 * The test first makes the deployment do the things that could leak (errors whose messages carry
 * the secret, requests with a session, tickets issued), then scans. The stub login provider exists
 * only in-process (auth.md "Stub provider"), so the authorization-code clause scans the entries of
 * an in-process reference app after a stub login, a replayed callback and a failed one.
 */
import { describe, expect, it } from "vitest";
import { client, tag, type ComplianceClient, type HttpResponse } from "../../harness/index.js";
import { referenceTestApp, type TestApp } from "../core/support/in-process.js";
import { cli, filesContaining, runCommand, scratchCopy } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR, REPO_ROOT, runDeployment, uniqueValue } from "../core/support/repo.js";
import { storedEntries, testSecretValue, waitForEntries } from "../core/support/stores.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Same-origin browser assets reachable from the entry page: the page, its scripts and styles, and their static imports. */
async function browserAssets(c: ComplianceClient): Promise<HttpResponse[]> {
  const seen = new Set<string>();
  const out: HttpResponse[] = [];
  const queue = ["/"];
  while (queue.length > 0 && out.length < 200) {
    const path = queue.shift() ?? "/";
    if (seen.has(path)) continue;
    seen.add(path);
    const r = await c.get(path);
    if (r.status !== 200) continue;
    out.push(r);
    const refs = [
      ...r.text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g),
      ...r.text.matchAll(/\b(?:import|from)\s*["']([^"']+)["']/g),
      ...r.text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((m) => m[1] ?? "");
    for (const ref of refs) {
      let url: URL;
      try {
        url = new URL(ref, new URL(path, c.baseUrl));
      } catch {
        continue;
      }
      if (url.origin !== c.baseUrl || url.pathname.startsWith("/api/")) continue;
      queue.push(`${url.pathname}${url.search}`);
    }
  }
  return out;
}

function hitsIn(text: string, needles: Readonly<Record<string, string>>): string[] {
  return Object.entries(needles).filter(([, needle]) => text.includes(needle)).map(([label]) => label);
}

describe("SEC: values stay secret", () => {
  it(
    tag("SEC-AC-002", "no test secret value in the repository, the build output, the browser assets, the stored log entries or error responses; no session cookie value or ticket URL in the stored entries"),
    async () => {
      const run = runDeployment();
      const secret = testSecretValue();
      const anonymous = client();
      const user = await anonymous.as("user", { id: uniqueValue("c-t1-sec-ac-002-") });

      // 1. Activity that could leak, recording every error response.
      const errorResponses: HttpResponse[] = [];
      const requestIds: string[] = [];
      for (const [who, c, path] of [
        ["anonymous", anonymous, "/api/ref/throw-secret"],
        ["anonymous", anonymous, "/api/ref/throw-secret-app"],
        ["user", user, "/api/ref/throw-secret"],
        ["user", user, "/api/ref/throw-plain"],
        ["user", user, "/api/errors/CORE.MISCONFIGURED"],
        ["user", user, "/api/does-not-exist"],
      ] as const) {
        const r = await c.get(path);
        expect(r.status, `${who} ${path} is an error`).toBeGreaterThanOrEqual(400);
        errorResponses.push(r);
        if (r.status >= 500 && r.requestId !== undefined) requestIds.push(r.requestId);
      }
      user.expectStatus(await user.post("/api/ref/log", { severity: "info", message: "c-t1 SEC-AC-002 entry written with a session" }), 200);

      const name = `ref/c-t1-${uniqueValue("sec-")}.txt`;
      user.expectStatus(await user.request("PUT", "/api/files/content", { json: { name, contentType: "text/plain", base64: Buffer.from("sec-ac-002").toString("base64") } }), 204);
      const tickets: unknown[] = [];
      try {
        tickets.push(user.expectStatus(await user.post("/api/files/upload-ticket", { name: `ref/c-t1-${uniqueValue("up-")}.txt`, contentType: "text/plain" }), 200).json<{ ticket: unknown }>().ticket);
        tickets.push(user.expectStatus(await user.post("/api/files/download-ticket", { name }), 200).json<{ ticket: unknown }>().ticket);
      } finally {
        await user.request("DELETE", `/api/files/content?name=${encodeURIComponent(name)}`);
      }
      const ticketUrls = tickets.map((t) => (t as { url?: unknown }).url).filter((u): u is string => typeof u === "string");
      expect(ticketUrls.length, "each issued ticket has a URL").toBe(2);

      // The error entries of the failing requests are stored before scanning.
      for (const id of requestIds) await waitForEntries(id, "SEC-AC-002");

      const secretNeedle = { "test secret value": secret };
      const cookieNeedles = Object.fromEntries(Object.entries(user.cookies()).filter(([, v]) => v.length >= 8).map(([k, v]) => [`session cookie ${k} value`, v]));
      expect(Object.keys(cookieNeedles).length, "the logged-in client holds a session cookie").toBeGreaterThan(0);
      const ticketNeedles = Object.fromEntries(ticketUrls.map((u, i) => [`ticket URL ${String(i + 1)}`, u]));

      // 2. Error responses (bodies and headers).
      for (const r of errorResponses) {
        expect(hitsIn(r.text + [...r.headers].map(([k, v]) => `${k}: ${v}`).join("\n"), secretNeedle), `${r.method} ${r.path} response`).toEqual([]);
      }

      // 3. The repository: tracked and untracked (not ignored) files.
      const grep = await runCommand("git", ["grep", "--untracked", "-I", "-l", "-F", "-e", secret], { cwd: REPO_ROOT, timeoutMs: 120_000 });
      expect(grep.status, `git grep for the secret value: ${grep.output}`).toBe(1);

      // 4. The build output: the deployment's own (.framework/ of the app), or a fresh build.
      const own = join(REFERENCE_DIR, ".framework");
      if (existsSync(own)) {
        expect(await filesContaining(own, secretNeedle), "the deployment's build output").toEqual([]);
      } else {
        const copy = await scratchCopy(REFERENCE_DIR, "sec-ac-002-build");
        try {
          const built = await cli(["build", "--target", run.target, "--stage", run.stage], { cwd: copy.dir, timeoutMs: 300_000 });
          expect(built.status, built.output).toBe(0);
          expect(await filesContaining(join(copy.dir, ".framework"), secretNeedle), "a fresh build's output").toEqual([]);
        } finally {
          await copy.remove();
        }
      }

      // 5. The deployed browser assets.
      const assets = await browserAssets(anonymous);
      expect(assets.length, "the entry page and its assets were fetched").toBeGreaterThan(1);
      for (const a of assets) expect(hitsIn(a.text, secretNeedle), `browser asset ${a.path}`).toEqual([]);

      // 6. The stored log entries of this deployment (today and yesterday, UTC).
      const entries = await storedEntries({ what: "SEC-AC-002" });
      expect(entries.length, "stored entries were found").toBeGreaterThan(0);
      const leaks = entries.flatMap((e) => hitsIn(e.raw, { ...secretNeedle, ...cookieNeedles, ...ticketNeedles }).map((label) => `${e.where}: ${label}`));
      expect(leaks, "stored log entries").toEqual([]);
    },
    600_000,
  );

  if (isLocal()) {
    it(tag("SEC-AC-002", "locally, the stored entries of a stub-provider login (successful, replayed and failed callbacks) contain no authorization code or session cookie value"), async () => {
      const app: TestApp = await referenceTestApp({ stubLoginProvider: true, secrets: { apiKey: "c-t1-in-process-value" } });
      try {
        // The stub provider's login redirects straight to the callback with a fresh state and code.
        const login = await app.request("/api/auth/login", { redirect: "manual" });
        expect(login.status).toBe(302);
        const location = new URL(login.headers.get("location") ?? "", "http://localhost");
        const code = location.searchParams.get("code") ?? "";
        expect(code.length, `the stub login redirect carries a code (${location.pathname})`).toBeGreaterThan(0);
        const transaction = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        const callbackPath = `${location.pathname}${location.search}`;
        const first = await app.request(callbackPath, { redirect: "manual", headers: transaction === "" ? {} : { cookie: transaction } });
        expect(first.status, "callback redirects").toBe(302);
        const session = (first.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        // Replayed callback and one with a wrong state.
        await app.request(callbackPath, { redirect: "manual", headers: transaction === "" ? {} : { cookie: transaction } });
        await app.request(`${location.pathname}?code=${encodeURIComponent(code)}&state=wrong-state`, { redirect: "manual" });
        // A complete stub login through the helper, and a failing request with that session.
        await app.loginWithStub(uniqueValue("sec-ac-002-subject-"));
        await app.request("/api/ref/throw-plain");

        const needles: Record<string, string> = { "authorization code": code };
        const sessionValue = session.split("=").slice(1).join("=");
        if (sessionValue.length >= 8) needles["session cookie value"] = sessionValue;
        const raw = app.logs().map((e) => JSON.stringify(e));
        expect(raw.length, "the login wrote entries (failed callbacks are logged)").toBeGreaterThan(0);
        expect(raw.flatMap((line, i) => hitsIn(line, needles).map((label) => `entry ${String(i)}: ${label}`))).toEqual([]);
      } finally {
        await app.dispose();
      }
    });
  }
});
