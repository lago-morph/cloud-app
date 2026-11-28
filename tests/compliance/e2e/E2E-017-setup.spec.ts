/**
 * E2E-017 — Setup with one token (Where: Local; DEC-0795…DEC-0800, plan-v0.2.0 §7.1 "Add" 1).
 *
 * One fake account (support/setup-edge.ts) from start to end, as a new user meets it:
 * `cloudflare-setup` with no credential prints the two-line template, the secrets file and the token
 * link; with the user's one token in `~/.secrets/cloudflare` (a temporary home directory here) it
 * sets the whole account up in one run, and a third run finds nothing to do. The admin app this
 * test then runs is the Worker that run uploaded (its module and its bindings, the client ID and
 * secret read from the account's Secrets Store), under local workerd, with mock-oauth2-server as
 * Cloudflare's OAuth and the edge as Cloudflare's API: it still refuses anyone but an administrator.
 * The live run is SETUP-AC-011's.
 *
 * Edge cases listed before writing (resources/edge-cases.md): no credential, one setting missing
 * (empty input); a missing permission, a token with more than needed (boundaries); the
 * environment over the file, a secrets file others can read (sources); a run interrupted while
 * deploying the admin app, run again (repetition: nothing made twice); the user's token never
 * deleted, rolled or updated (state); anonymous, a member who is not an administrator, and someone
 * outside the account (access). Not applicable: text and order (setup takes no names or lists from
 * the user).
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { cloudflareSetupCommand } from "../../../packages/framework/src/cli/commands/cloudflare-setup.js";
import { captureIo } from "../../../packages/framework/src/cli/io.test-support.js";
import { ADMIN_APP_COMPATIBILITY_DATE, ADMIN_APP_COMPATIBILITY_FLAGS, ADMIN_APP_MODULE } from "../../../packages/framework/src/provision/cloudflare/admin-app-deploy.js";
import { ACCOUNT } from "../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { APP_SCRIPTS, CLIENT_NAMES, CLIENT_SECRET_NAMES } from "../../../packages/framework/src/provision/cloudflare/oauth-clients.js";
import { deepLink, TOKEN } from "../../../packages/framework/src/provision/cloudflare/permissions.js";
import { SetupWorld } from "../../../packages/framework/src/provision/cloudflare/setup-world.test-support.js";
import { startMockOAuth2, type MockOAuth2 } from "../../support/mock-oauth2/launcher.js";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { startSetupEdge, type SetupEdge } from "./support/setup-edge.js";

const NOW = new Date("2026-11-27T12:00:00.000Z");
const SUB = "e2e017sub";
const VALUE = (n: number) => `e2e017-user-token-value-${String(n)}-0123456789abcdef`;
const outputs: string[] = [];
const dirs: string[] = [];

test.describe.configure({ mode: "serial" });

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A project folder (the old file listed in .gitignore, as the template's is). */
function project(): string {
  const dir = temp("e2e017-");
  writeFileSync(join(dir, ".gitignore"), ".env.cloudflare\n");
  return dir;
}

/** A home directory; with `text`, its ~/.secrets/cloudflare at `mode`. */
function home(text?: string, mode = 0o600): string {
  const dir = temp("e2e017-home-");
  if (text !== undefined) writeSecrets(dir, text, mode);
  return dir;
}
function writeSecrets(homeDir: string, text: string, mode = 0o600): void {
  mkdirSync(join(homeDir, ".secrets"), { recursive: true });
  writeFileSync(join(homeDir, ".secrets", "cloudflare"), text, { mode });
  chmodSync(join(homeDir, ".secrets", "cloudflare"), mode);
}
const credential = (token: string) => `CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`;

/** `cloudflare-setup` as the CLI binds it, with the fake account's API in place of Cloudflare's (DEC-0761). */
async function setup(world: SetupWorld, dir: string, homeDir: string, env: Record<string, string> = {}): Promise<{ status: number; out: string }> {
  const io = captureIo(dir);
  const status = await cloudflareSetupCommand({
    env,
    home: homeDir,
    apiFor: world.apiFor,
    reach: async () => {},
    // The local setup's npm steps are LOCAL-AC's; here only its git-ignore step runs.
    localSetup: async (d, o) => [{ step: "gitignore", result: (await o.ensureIgnored(d)) === "added" ? "applied" : "already" }],
    stepOptions: { newSubdomain: () => SUB },
    frameworkVersion: "0.2.0-e2e",
    now: () => NOW,
  })([], io);
  outputs.push(io.out, io.err);
  return { status, out: io.out + io.err };
}

function freshWorld(token?: { value: string; groups?: typeof TOKEN }): SetupWorld {
  const world = new SetupWorld();
  world.cloud().subdomain = undefined;
  if (token !== undefined) world.addToken("token", token.value, `tok-${token.value.slice(-6)}`, token.groups === undefined ? {} : { groups: token.groups });
  return world;
}

/** Requests that update, roll or delete the token `id`, sent with any token. */
const writesOf = (world: SetupWorld, id: string): string[] => world.requests.filter((r) => !/ GET /.test(r) && r.includes(`/tokens/${id}`));

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? filesUnder(join(dir, n)) : [readFileSync(join(dir, n), "utf8")]));

test.afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test(tag("E2E-017", "no credential: the two-line template, the secrets file, the token link and the next prompt; nothing written or sent; one setting missing names it"), async () => {
  const world = freshWorld();
  const homeDir = home();
  const dir = project();
  const r = await setup(world, dir, homeDir);
  expect(r.status).toBe(1);
  expect(r.out).toContain("CLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=\n");
  expect(r.out).toContain(join(homeDir, ".secrets", "cloudflare"));
  expect(r.out).toContain(deepLink("token"));
  expect(r.out).toContain("continue prototype setup");
  expect(world.requests).toEqual([]);
  expect(readdirSync(homeDir)).toEqual([]);
  const partial = await setup(world, dir, home(`CLOUDFLARE_API_TOKEN=${VALUE(9)}\n`));
  expect(partial.status).toBe(1);
  expect(partial.out).toContain("CLOUDFLARE_ACCOUNT_ID is not set");
  expect(world.requests).toEqual([]);
});

test(tag("E2E-017", "a token missing a permission: named as the dashboard shows it, with the link; nothing written; the token kept as it was"), async () => {
  const world = freshWorld({ value: VALUE(1), groups: TOKEN.filter((g) => g.name !== "OAuth Client Write") });
  const r = await setup(world, project(), home(credential(VALUE(1))));
  expect(r.status).toBe(1);
  expect(r.out).toContain("OAuth Client Edit");
  expect(r.out).toContain(deepLink("token"));
  expect(world.writes()).toEqual([]);
  expect(world.token(`tok-${VALUE(1).slice(-6)}`).deleted).toBe(false);
});

test(tag("E2E-017", "the environment wins over the file, and a secrets file others can read is warned about without failing the run"), async () => {
  const world = freshWorld({ value: VALUE(2) });
  const homeDir = home(credential("e2e017-stale-value-in-the-file"), 0o644);
  const r = await setup(world, project(), homeDir, { CLOUDFLARE_API_TOKEN: VALUE(2) });
  expect(r.status, r.out).toBe(0);
  expect(r.out).toContain("CLOUDFLARE_API_TOKEN: from the environment variable CLOUDFLARE_API_TOKEN");
  expect(r.out).toContain(`chmod 600 ${join(homeDir, ".secrets", "cloudflare")}`);
  expect(world.requests.filter((q) => q.startsWith("? "))).toEqual([]);
});

// The main account, carried through the rest of the file.
const world = freshWorld({ value: VALUE(4) });
const userTokenId = `tok-${VALUE(4).slice(-6)}`;
const appDir = project();
const appHome = home();
let oauth: MockOAuth2 | undefined;
let edge: SetupEdge;
let mf: Miniflare | undefined;
let adminOrigin = "";
const seen: string[] = [];

test.afterAll(async () => {
  await mf?.dispose();
  await edge?.close();
  await oauth?.stop();
});

test(tag("E2E-017", "one token in ~/.secrets/cloudflare: interrupted while deploying the admin app, then run again, the account is set up in one run with nothing made twice; a third run changes nothing; the token is never changed"), async () => {
  writeSecrets(appHome, credential(VALUE(4)));
  const before = JSON.stringify(world.token(userTokenId).policies);
  const upload = `PUT /accounts/${ACCOUNT}/workers/scripts/${APP_SCRIPTS.admin}`;
  world.cloud().override.set(upload, { status: 500, body: { success: false, errors: [{ code: 10013, message: "internal error" }], result: null } });
  const first = await setup(world, appDir, appHome);
  expect(first.status).toBe(1);
  world.cloud().override.delete(upload);
  const again = await setup(world, appDir, appHome);
  expect(again.status, again.out).toBe(0);
  expect(again.out).toContain("Cloudflare setup is complete.");
  expect(again.out).toContain("npm run deploy -- --target cloudflare --stage test-first");
  const cloud = world.cloud();
  expect([...cloud.oauthClients.values()].map((c) => c.name).sort()).toEqual([CLIENT_NAMES.admin, CLIENT_NAMES.signin].sort());
  expect(cloud.workers.has(APP_SCRIPTS.signin), "the auth app is deployed").toBe(true);
  expect(cloud.d1Databases.map((d) => d.name)).toEqual(["prototype-auth"]);
  expect([...cloud.buckets.keys()]).toEqual(expect.arrayContaining(["prototype-logs", "sst-state", "prototype-backups"]));
  expect([...cloud.tokens.values()].filter((t) => t.name === "prototype-r2-signing")).toHaveLength(1);
  adminOrigin = /https:\/\/prototype-admin\.[a-z0-9-]+\.workers\.dev/.exec(again.out)?.[0] ?? "";
  expect(adminOrigin, "the summary prints the admin app's URL").toBe(`https://${APP_SCRIPTS.admin}.${SUB}.workers.dev`);

  const writesBefore = world.writes().length;
  const third = await setup(world, appDir, appHome);
  expect(third.status, third.out).toBe(0);
  expect(third.out).toContain("Everything is already set up and current: nothing to do.");
  expect(world.writes().slice(writesBefore)).toEqual([]);

  expect(writesOf(world, userTokenId)).toEqual([]);
  expect(world.token(userTokenId).deleted).toBe(false);
  expect(JSON.stringify(world.token(userTokenId).policies)).toBe(before);
  expect(readFileSync(join(appHome, ".secrets", "cloudflare"), "utf8")).toBe(credential(VALUE(4)));
});

/** The uploaded admin app's bindings as values: plain text as is, Secrets Store bindings read from the account's store. */
function uploadedEnv(): Record<string, { type: "text"; value: string }> {
  const worker = world.cloud().workers.get(APP_SCRIPTS.admin)!;
  const env: Record<string, { type: "text"; value: string }> = {};
  for (const b of worker.bindings as { type: string; name: string; text?: string; store_id?: string; secret_name?: string }[]) {
    if (b.type === "plain_text") env[b.name] = { type: "text", value: b.text ?? "" };
    else if (b.type === "secrets_store_secret") env[b.name] = { type: "text", value: world.cloud().secretStores.get(b.store_id!)!.secrets.get(b.secret_name!)!.value };
    else throw new Error(`the admin app has an unexpected binding ${b.type} ${b.name}`);
  }
  return env;
}

/** A browser: a cookie jar, Origin on POSTs, no redirects followed. */
class Browser {
  readonly jar = new Map<string, string>();
  async go(pathOrUrl: string, method: "GET" | "POST" = "GET"): Promise<{ status: number; location: string | null; text: string }> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${adminOrigin}${pathOrUrl}`;
    const headers: Record<string, string> = { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    if (method === "POST") headers.origin = adminOrigin;
    // Through Miniflare's entry, as a request to the Worker's own URL (getWorker's route refuses a non-local Origin).
    const res = await mf!.dispatchFetch(url, { method, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (/Max-Age=0/i.test(c)) this.jar.delete(pair.slice(0, eq));
      else this.jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const text = await res.text();
    seen.push(text, JSON.stringify([...res.headers]));
    return { status: res.status, location: res.headers.get("location"), text };
  }

  /** Starts a grant (`/signin` or a page), plays `sub` at the issuer's login, follows the callback. */
  async grant(path: string, sub: string): Promise<{ status: number; text: string; scope: string }> {
    const start = await this.go(path, "POST");
    expect(start.status, start.text).toBe(302);
    edge.noteAuthorize(start.location!);
    const login = await fetch(start.location!, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: sub, claims: JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true }) }) });
    expect(login.status).toBe(302);
    return { ...(await this.go(login.headers.get("location")!)), scope: new URL(start.location!).searchParams.get("scope") ?? "" };
  }
}

test(tag("E2E-017", "admin app as deployed: an anonymous visitor, a member who is not an administrator and someone outside the account are refused; an administrator signs in"), async () => {
  test.setTimeout(600_000);
  expect(adminOrigin, "the setup test ran first").not.toBe("");
  oauth = await startMockOAuth2();
  edge = await startSetupEdge(world, oauth.baseUrl);
  edge.members.set("owner", { roles: ["Super Administrator - All Privileges"] });
  edge.members.set("member", { roles: ["HTTP Applications Read"] });
  const worker = world.cloud().workers.get(APP_SCRIPTS.admin)!;
  mf = new Miniflare({
    handleStructuredLogs: (log) => void seen.push(JSON.stringify(log)),
    workers: [
      {
        config: {
          name: "admin",
          compatibilityDate: ADMIN_APP_COMPATIBILITY_DATE,
          compatibilityFlags: [...ADMIN_APP_COMPATIBILITY_FLAGS],
          manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: worker.modules!.get(ADMIN_APP_MODULE)! } } },
          // Cloudflare's OAuth and API are the local stand-ins (the settings only tests set, PAR-418).
          env: { ...uploadedEnv(), ADMIN_DISCOVERY_URL: { type: "text", value: edge.discoveryUrl }, ADMIN_API_BASE: { type: "text", value: edge.apiBase } },
        },
      },
    ],
  });
  const anonymous = new Browser();
  expect((await anonymous.go("/setup")).location).toBe("/");
  const refused = await anonymous.go("/setup", "POST");
  expect(refused.status, refused.text).toBe(401);
  for (const sub of ["member", "stranger"]) {
    const b = new Browser();
    expect((await b.grant("/signin", sub)).status, sub).toBe(403);
    expect(b.jar.has("__Host-admin-session"), sub).toBe(false);
  }
  const owner = new Browser();
  expect((await owner.grant("/signin", "owner")).status).toBe(303);
  expect((await owner.go("/")).text).toContain('href="/setup"');
});

test(tag("E2E-017", "no token value, access token or client secret appears in any output, project file or admin-app response"), () => {
  expect(adminOrigin, "the setup test ran first").not.toBe("");
  const files = filesUnder(appDir).join("\n");
  const all = [...outputs, ...seen].join("\n");
  for (const n of [1, 2, 4, 9]) expect(all + files).not.toContain(VALUE(n));
  for (const g of edge.grants) {
    expect(all).not.toContain(g.access);
    expect(all).not.toContain(g.refresh);
  }
  // Every secret the store holds, except the OAuth client IDs (identifiers, not secrets: plan §5.1 stores them beside their secrets).
  const ids = new Set(Object.values(CLIENT_SECRET_NAMES).map((n) => n.id));
  for (const store of world.cloud().secretStores.values()) for (const [name, s] of store.secrets) if (!ids.has(name)) expect(all + files, name).not.toContain(s.value);
});
