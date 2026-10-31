/**
 * The local real-sign-in stack for E2E-005's and E2E-007's auth-app parts and E2E-018 (plan-v0.2.0
 * §4.1, §7.1; e2e-scenarios.md preamble): everything a production stage signs in with, locally.
 *
 * - **The app:** the reference app built as a production stage (`build --target cloudflare --stage
 *   prodcheck`, so no mock is in it and its provider is the auth app's), its bundle run under local
 *   workerd with a local D1 (its migrations applied as `deploy` applies them) and R2.
 * - **The auth app:** its Worker bundle with its own D1, bound to the app as `AUTH` (entrypoint
 *   `AuthApp`) through a gate Worker that can make it unavailable (`setAuthAppDown`): the binding
 *   then throws and its pages answer 503, as an outage does.
 * - **Upstream:** mock-oauth2-server as Cloudflare's OAuth (real PKCE, RS256 ID tokens), and the fake
 *   `/user` and `/memberships` of the auth app's own integration suite (`members`, by `sub`).
 * - **The registry:** written and cleared with `deploy`'s and `remove`'s own link
 *   (`cloudflareAuthAppLink`), whose D1 HTTP API calls run against the auth app's local D1.
 *
 * Both Workers are served on `localhost` ports by a small front, so a browser and plain HTTP clients
 * reach them by their origins (`appOrigin`, `authOrigin`), as on Cloudflare.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { bundleAuthAppWorker } from "../../../../packages/framework/src/auth-app/worker-bundle.test-support.js";
import { COMPATIBILITY_DATE, COMPATIBILITY_FLAGS } from "../../../../packages/framework/src/build/build.js";
import { d1MigrationDatabase, migrateLocal, type D1Like } from "../../../../packages/framework/src/mig/apply.js";
import type { ApiReply, CloudflareApi } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { cloudflareAuthAppLink, type AuthAppLink } from "../../../../packages/framework/src/provision/cloudflare/worker.js";
import { ACCOUNT_ID, startEdge, type Edge } from "../../../../packages/framework/test/integration/auth-app/support.js";
import { startMockOAuth2, type MockOAuth2 } from "../../../support/mock-oauth2/launcher.js";
import { copyApp, removeDir } from "./apps.js";
import { frameworkCli, REFERENCE_DIR, tail } from "./process.js";

/** The production stage the app is built as; its app ID at the auth app is `reference-prodcheck`. */
export const STAGE = "prodcheck";
export const APP_ID = `reference-${STAGE}`;
const AUTH_DB_ID = "auth-registry-db";

const GATE_WORKER = `
import { WorkerEntrypoint } from "cloudflare:workers";
const down = async (env) => (await env.FLAG.get("down")) !== null;
export class AuthApp extends WorkerEntrypoint {
  async redeem(input) { if (await down(this.env)) throw new Error("auth app unavailable"); return this.env.REAL.redeem(input); }
  async role(sub) { if (await down(this.env)) throw new Error("auth app unavailable"); return this.env.REAL.role(sub); }
}
export default { async fetch(request, env) { return (await down(env)) ? new Response("unavailable", { status: 503 }) : env.REAL_HTTP.fetch(request); } };
`;

export interface SignInStack {
  readonly appOrigin: string;
  readonly authOrigin: string;
  readonly oauth: MockOAuth2;
  readonly edge: Edge;
  readonly members: Edge["members"];
  /** `deploy`'s and `remove`'s registry link, against the local auth app's database. */
  readonly registry: AuthAppLink;
  /** Every app response's body and headers, for the no-provider-detail checks. */
  readonly appResponses: { url: string; status: number; text: string; headers: string }[];
  setAuthAppDown(down: boolean): Promise<void>;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length === 0 ? undefined : new Uint8Array(Buffer.concat(chunks));
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** The D1 HTTP API's `/query` and the auth app Worker's settings, answered from the local registry database. */
function registryApi(db: () => Promise<D1Like>): CloudflareApi {
  return async (method, path, body): Promise<ApiReply> => {
    if (method === "GET" && path === `/accounts/${ACCOUNT_ID}/workers/scripts/prototype-auth/settings`) {
      return { status: 200, body: { success: true, errors: [], result: { bindings: [{ type: "d1", name: "DB", id: AUTH_DB_ID }] } } };
    }
    if (method === "POST" && path === `/accounts/${ACCOUNT_ID}/d1/database/${AUTH_DB_ID}/query`) {
      const d = await db();
      const batch = (body as { batch: { sql: string; params?: unknown[] }[] }).batch;
      const results = (await d.batch(batch.map((s) => d.prepare(s.sql).bind(...(s.params ?? []))))) as { results?: unknown[] }[];
      return { status: 200, body: { success: true, errors: [], result: results.map((r) => ({ results: r.results ?? [], success: true })) } };
    }
    return { status: 404, body: { success: false, errors: [{ code: 7003, message: `no route ${method} ${path}` }], result: null } };
  };
}

export async function startSignInStack(): Promise<SignInStack> {
  const oauth = await startMockOAuth2();
  const edge = await startEdge(oauth.baseUrl);
  const copy = copyApp(REFERENCE_DIR, "signin");
  const built = await frameworkCli(copy, ["build", "--target", "cloudflare", "--stage", STAGE], { timeoutMs: 300_000 });
  if (built.status !== 0) throw new Error(`building the reference app as a production stage failed:\n${tail(built.output)}`);
  const bundle = readFileSync(join(copy, ".framework", "cloudflare", "worker.js"), "utf8");

  const appFront = createServer();
  const authFront = createServer();
  const appOrigin = `http://localhost:${String(await listen(appFront))}`;
  const authOrigin = `http://localhost:${String(await listen(authFront))}`;
  const text = (value: string) => ({ type: "text" as const, value });
  const esm = (contents: string) => ({ mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents } } });
  const sessionKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "app",
          compatibilityDate: COMPATIBILITY_DATE,
          compatibilityFlags: [...COMPATIBILITY_FLAGS],
          manifest: esm(bundle),
          env: {
            DB: { type: "d1" as const, id: "app-db" },
            FILES: { type: "r2" as const, name: "reference-prodcheck-files" },
            FRAMEWORK_PUBLIC_ORIGIN: text(appOrigin),
            FRAMEWORK_AUTH_APP_ORIGIN: text(authOrigin),
            FRAMEWORK_R2_ACCOUNT_ID: text(ACCOUNT_ID),
            FRAMEWORK_FILES_BUCKET: text("reference-prodcheck-files"),
            SECRET_FRAMEWORK_SESSION_KEY: text(sessionKey),
            SECRET_API_KEY: text(`e2e-${crypto.randomUUID()}`),
            AUTH: { type: "worker" as const, worker: "gate", exportName: "AuthApp" },
          },
        },
      },
      {
        config: {
          name: "gate",
          compatibilityDate: COMPATIBILITY_DATE,
          manifest: esm(GATE_WORKER),
          env: { FLAG: { type: "kv" as const, id: "gate-flag" }, REAL: { type: "worker" as const, worker: "auth", exportName: "AuthApp" }, REAL_HTTP: { type: "worker" as const, worker: "auth" } },
        },
      },
      {
        config: {
          name: "auth",
          compatibilityDate: COMPATIBILITY_DATE,
          manifest: esm(await bundleAuthAppWorker()),
          env: {
            DB: { type: "d1" as const, id: AUTH_DB_ID },
            AUTH_APP_CLIENT_ID: text("signin-client"),
            AUTH_APP_CLIENT_SECRET: text(`signin-secret-${crypto.randomUUID()}`),
            AUTH_APP_ACCOUNT_ID: text(ACCOUNT_ID),
            AUTH_APP_ORIGIN: text(authOrigin),
            AUTH_APP_DISCOVERY_URL: text(edge.discoveryUrl),
            AUTH_APP_API_BASE: text(edge.apiBase),
          },
        },
      },
    ],
  } as ConstructorParameters<typeof Miniflare>[0]);

  // `deploy` applies the framework's and the app's migrations to the stage's D1 before it starts the Worker.
  await migrateLocal(d1MigrationDatabase((await mf.getD1Database("DB", "app")) as unknown as Parameters<typeof d1MigrationDatabase>[0]), join(copy, "migrations"));

  const appResponses: SignInStack["appResponses"] = [];
  const forward = (worker: string, origin: string, record: boolean) => (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    void (async () => {
      const url = `${origin}${req.url ?? "/"}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const answer = await (await mf.getWorker(worker)).fetch(url, { method: req.method ?? "GET", headers, redirect: "manual", ...(body === undefined ? {} : { body }) });
      const bytes = Buffer.from(await answer.arrayBuffer());
      const out: Record<string, string | string[]> = {};
      answer.headers.forEach((value, name) => {
        if (name !== "set-cookie" && name !== "content-length" && name !== "content-encoding" && name !== "transfer-encoding") out[name] = value;
      });
      const cookies = answer.headers.getSetCookie();
      if (cookies.length > 0) out["set-cookie"] = cookies;
      if (record) appResponses.push({ url, status: answer.status, text: bytes.toString("utf8"), headers: JSON.stringify(out) });
      res.writeHead(answer.status, out);
      res.end(bytes);
    })().catch((e: unknown) => {
      res.writeHead(502);
      res.end(String(e));
    });
  };
  appFront.on("request", forward("app", appOrigin, true));
  authFront.on("request", forward("gate", authOrigin, false));

  // The auth app applies its schema on its first request.
  await (await fetch(`${authOrigin}/`)).text();
  const registry = cloudflareAuthAppLink(
    registryApi(async () => (await mf.getD1Database("DB", "auth")) as unknown as D1Like),
    ACCOUNT_ID,
  );
  return {
    appOrigin,
    authOrigin,
    oauth,
    edge,
    members: edge.members,
    registry,
    appResponses,
    async setAuthAppDown(down) {
      const flag = await mf.getKVNamespace("FLAG", "gate");
      if (down) await flag.put("down", "1");
      else await flag.delete("down");
    },
    async close() {
      await mf.dispose();
      await new Promise<void>((r) => appFront.close(() => r()));
      await new Promise<void>((r) => authFront.close(() => r()));
      await edge.close();
      await oauth.stop();
      removeDir(copy);
    },
  };
}
