/**
 * `cloudflare-setup`: the re-runnable Cloudflare setup with the user's one token (DEC-0795…DEC-0799;
 * earlier plan-setup-wizard §4.3, DEC-0584…DEC-0590). Each run reads the current state and does only
 * what is missing:
 *
 * 0. **Local setup** (`runLocalSetup`, DEC-0591): dependencies, local secrets, the old
 *    `.env.cloudflare` in `.gitignore` (git-safety's `ensureEnvCloudflareIgnored`).
 * 1. **Git**: the warnings of `gitSafetyWarnings` (not a repository; an old `.env.cloudflare` not
 *    ignored or tracked) on every run, set off by rule lines; never a failure.
 * 2. **The credential** (`readCloudflareSettings`, DEC-0795): `CLOUDFLARE_API_TOKEN` and
 *    `CLOUDFLARE_ACCOUNT_ID` from the environment, else from the secrets file
 *    (`~/.secrets/cloudflare`, or `CLOUDFLARE_SECRETS_FILE`). Its notices (a file others can read,
 *    DEC-0800; an old `.env.cloudflare` or bootstrap token that is no longer read, DEC-0799) are
 *    printed. Either setting missing: the two-line template, where it goes, the token's deep link and
 *    the next prompt; stop. Which source each setting came from is said, never its value.
 * 3. **The token**: valid and active (`GET /accounts/<a>/tokens/verify`, or `/user/tokens/verify`
 *    for a user token), and the accounts it sees (`GET /accounts`). The account
 *    `CLOUDFLARE_ACCOUNT_ID` names must be one of them.
 * 4. **Its permissions** (DEC-0797): its own policies (`GET …/tokens/<its ID>`), compared with
 *    `TOKEN`. More than needed: nothing is said. Any missing: exactly which, and the deep link; stop.
 *    Policies it cannot read mean "Account API Tokens Write" is missing.
 * 5. **The account setup**, when the setup record is not current (`checkAccountSetup`): the
 *    `workers.dev` subdomain, the admin and sign-in OAuth clients with their secrets in Secrets
 *    Store, the admin app (v0.2.0 plan §5.1's bootstrap, DEC-0684…DEC-0686), then the account setup
 *    the admin app's page 1 also runs (`runAccountSetup`: the auth app, the shared buckets, the
 *    signing credential, the setup record; DEC-0798). Current: nothing is written.
 * 6. **Network**: `api.cloudflare.com`, the account's R2 storage host and its `workers.dev`
 *    subdomain, each named by its kind only.
 * 7. **Summary** and the next step.
 *
 * The user's token is never deleted, rolled or updated (DEC-0796): every token write goes through a
 * guard (DEC-0589, DEC-0618), an allow-list that lets through only a DELETE of a signing token the
 * guard saw by its name (`prototype-r2-signing`, which the account setup mints and replaces), never
 * a PUT or a roll, never anything on the user's token's ID, and never anything on an ID in
 * `protectedTokenIds`. Output never holds a token value, an account ID, a token ID or the
 * `workers.dev` subdomain (DEC-0573, DEC-0590): messages are written without them, and every line is
 * also passed through a redaction of each such value known to the run; only the admin app's URL is
 * printed past it (DEC-0686).
 * Exit status: 0 when the account is set up and reachable, 1 when the run stopped for something the
 * user must do or failed (DEC-0588).
 */
import { formatGitWarning } from "../../cli/cloudflare-settings.js";
import { bundleAuthApp, frameworkVersion as packageVersion } from "../../admin-app/bundle.js";
import { describeLocalSetup, runLocalSetup, type EnsureIgnoredResult, type LocalSetupDeps, type LocalSetupOutcome } from "../core/local-setup.js";
import { EXIT, messageOf, type ProvisionIo, type ProvisionStatus } from "../core/output.js";
import { accountSubdomain } from "./account.js";
import { runAccountSetup } from "./account-setup-run.js";
import { deployAdminApp } from "./admin-app-deploy.js";
import { CloudflareRequestsStopped, describeFailure, sentPath, succeeded, type ApiReply, type CloudflareApi } from "./api.js";
import type { Environment } from "./environment.js";
import { ensureEnvCloudflareIgnored, gitSafetyWarnings, inspectGitSafety } from "./git-safety.js";
import { ACCOUNT_SETUP_VERSION, comparePolicies, dashboardName, deepLink, TOKEN, TOKEN_NAMES, type PermissionGroup, type TokenDetails } from "./permissions.js";
import { APP_SCRIPTS, CLIENT_NAMES, ensureOAuthClients, ensureSubdomain, type ClientKind } from "./oauth-clients.js";
import { SIGNING_TOKEN_NAME } from "./r2-token.js";
import { ensureStore } from "./secrets-store.js";
import { checkAccountSetup, type SetupStepOptions } from "./setup-steps.js";
import { CREDENTIAL_TEMPLATE, describeSource, readCloudflareSettings, SETTING_NAMES, type CloudflareSettings, type SettingName } from "./token-sources.js";

const COMMAND = "cloudflare-setup";

/** The settings of the one credential (DEC-0795). */
export const TOKEN_SETTING = "CLOUDFLARE_API_TOKEN";
export const ACCOUNT_SETTING = "CLOUDFLARE_ACCOUNT_ID";

/** The phrase that runs the setup again (plan §3.2). */
export const NEXT_PROMPT = 'Then say "continue prototype setup" (or run /prototype-framework continue setup); on the command line, run npm run cloudflare-setup again.';

/** The environment variable naming token IDs setup must never update or delete (comma-separated; PAR-361). */
export const PROTECTED_TOKEN_IDS_ENV = "PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS";

/** A made-up Worker name whose host under the account's `workers.dev` subdomain the network check requests (DEC-0590). */
export const REACHABILITY_SCRIPT = "prototype-framework-reachability";

/** The first stage to deploy after setup (plan §4.3 step 9). */
export const FIRST_TEST_STAGE = "test-first";

export interface CloudflareSetupDeps {
  /** The project (app) directory. */
  readonly projectDir: string;
  /** The process environment, not yet merged with the secrets file. */
  readonly env: Environment;
  /** The home directory the default secrets file is under (default `HOME`, else `os.homedir()`). */
  readonly home?: string;
  /** The Cloudflare API with one token. */
  apiFor(token: string): CloudflareApi;
  /** Step 0 (default `runLocalSetup`, with `ensureIgnored` given). */
  localSetup?(projectDir: string, deps: Pick<LocalSetupDeps, "ensureIgnored">): Promise<readonly LocalSetupOutcome[]>;
  /**
   * Resolves when an HTTPS request to `url` got any answer; rejects when the host cannot be reached.
   * A `CloudflareRequestsStopped` rejection (a request layer's budget or 429 stop) ends the run.
   */
  reach(url: string): Promise<void>;
  /** Token IDs never to update or delete (DEC-0589), in addition to `PROTECTED_TOKEN_IDS_ENV`. */
  readonly protectedTokenIds?: readonly string[];
  /** The setup steps' options (the new subdomain). */
  readonly stepOptions?: Omit<SetupStepOptions, "note">;
  /** The version recorded in the setup record (default this package's). */
  readonly frameworkVersion?: string;
  /** The auth app's Worker module (default `bundleAuthApp`). */
  readonly authAppSource?: () => string | Promise<string>;
  readonly now?: () => Date;
  /** Why this process cannot reach Cloudflare (`cloudProcessProblems`): checked before the first request, after the steps that need none. */
  readonly unreachable?: string;
}

interface Account {
  readonly id: string;
  readonly name: string;
}

interface Token {
  readonly value: string;
  readonly api: CloudflareApi;
  readonly id: string;
  /** The account that owns an account API token. */
  readonly owner?: Account;
  /** A user API token (made under My Profile). */
  readonly user: boolean;
  /** The accounts the token can see. */
  readonly accounts: readonly Account[];
}

/** What to choose on the token link's page: the link cannot set the account, and the expiry is the user's. */
export const TOKEN_PAGE_CHOICES =
  "On the page: pick your account if the dashboard asks; keep every ticked permission (more is fine); choose any end date, or none. Then choose Continue to summary, then Create Token, and copy the token.";

/** Where the account ID is shown (setup never prints it, DEC-0590). */
export const ACCOUNT_ID_HELP =
  "Your account ID is on the account's home page in the dashboard (Account ID), and in the dashboard's address once you pick the account: dash.cloudflare.com/<account ID>/…";

/** The deep link with what to choose on its page (DEC-0564, DEC-0797). */
export function tokenLinkBlock(): string {
  return `Make the token from this pre-filled dashboard link (name ${TOKEN_NAMES.token}):\n  ${deepLink("token")}\n  ${TOKEN_PAGE_CHOICES}\n`;
}

/** Where the two lines go (owner decision 2, DEC-0795): the secrets file, or a cloud session's environment variables. */
export function whereItGoes(filePath: string): string {
  return [
    "Where the two lines go (filled in), either:",
    `  - on this machine, in the file ${filePath}, shared by every project (keep it private: chmod 600 ${filePath}); or`,
    "  - as environment variables, the same two NAME=value lines: in a Claude Code cloud session, open the environment menu, choose Edit and add them under Environment variables, then start a new session; in a shell, export them.",
    "The environment variables win over the file.",
  ].join("\n") + "\n";
}

/** The whole no-credential output (owner decision 2, DEC-0795): the template, where it goes, the link and the next prompt. */
export function noCredentialText(filePath: string, missing: readonly SettingName[] = SETTING_NAMES): string {
  const which = missing.length === SETTING_NAMES.length ? "No Cloudflare credential was found" : `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set`;
  return [
    `${which}. The framework needs one Cloudflare API token and your account ID; setup never prints either.\n`,
    `Copy these two lines and fill in the values:\n\n${CREDENTIAL_TEMPLATE}`,
    whereItGoes(filePath),
    tokenLinkBlock(),
    `${ACCOUNT_ID_HELP}\n`,
    `${NEXT_PROMPT}\n`,
  ].join("\n");
}

/** Replaces every known sensitive value in the text (DEC-0590). */
function redactor(): { add(value: string | undefined): void; redact(text: string): string } {
  const values = new Set<string>();
  return {
    add(value) {
      if (value !== undefined && value.trim().length >= 4) values.add(value.trim());
    },
    redact(text) {
      let out = text;
      for (const v of [...values].sort((a, b) => b.length - a.length)) out = out.split(v).join("[hidden]");
      return out;
    },
  };
}

/** An API token's own path, `/accounts/<a>/tokens/<id>` or `/user/tokens/<id>`, with any sub-path (such as `/value`, the roll); any case. */
const TOKEN_PATH = /^\/(?:accounts\/[^/]+|user)\/tokens\/([^/]+)(\/.*)?$/i;
/** Paths under `tokens/` that are not a token's ID. */
const NOT_TOKEN_IDS = new Set(["verify", "permission_groups"]);
/** The token list or create path, `/accounts/<a>/tokens` or `/user/tokens`; any case. */
const TOKENS_LIST_PATH = /^\/(?:accounts\/[^/]+|user)\/tokens\/?$/i;

/**
 * The token write guard (DEC-0589, DEC-0613, DEC-0796): every request through `api` other than a
 * GET that names an API token's ID is checked before it is sent. The path judged is the one sent
 * (`sentPath`: `API_BASE + path` as the URL parser normalises it, each segment decoded), and IDs
 * and the path's names are compared in any case. Refused: anything on a protected ID; anything on
 * the user's own token (`userTokenId`): setup never deletes, rolls or updates it; any method but
 * DELETE (a PUT included) and any sub-path (the value roll); a DELETE of any ID the guard did not
 * see as a signing token (DEC-0618); a request whose URL cannot be parsed. Creating a token
 * (`POST …/tokens`, the signing step) names no ID. The signing step's rotation finds its old tokens
 * by name (`GET …/tokens`) and may delete the token it just created when its record cannot be
 * written, so the guard learns the IDs of tokens named `SIGNING_TOKEN_NAME` from the token lists and
 * creates that pass through it. Every token ID those answers name goes to `onTokenId` (the run's
 * redaction, SETUP-REQ-007).
 */
export function guardTokenWrites(api: CloudflareApi, rules: { readonly protectedIds: ReadonlySet<string>; readonly userTokenId?: string; readonly onTokenId?: (id: string) => void }): CloudflareApi {
  const protectedIds = new Set([...rules.protectedIds].map((id) => id.toLowerCase()));
  const userTokenId = rules.userTokenId?.toLowerCase();
  const signingIds = new Set<string>();
  const learnSigning = (item: unknown) => {
    const { id, name } = (item ?? {}) as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || id === "") return;
    rules.onTokenId?.(id);
    if (name === SIGNING_TOKEN_NAME) signingIds.add(id.toLowerCase());
  };
  return async (method, path, body) => {
    if (method !== "GET") {
      const refuse = (why: string) => {
        throw new Error(`setup refused to ${method === "DELETE" ? "delete" : "change"} an API token: ${why}`);
      };
      const sent = sentPath(path);
      if (sent === undefined) refuse("its URL cannot be read");
      const m = TOKEN_PATH.exec(sent ?? "");
      const id = m?.[1]?.toLowerCase();
      if (id !== undefined && !NOT_TOKEN_IDS.has(id)) {
        if (protectedIds.has(id)) refuse("its ID is protected");
        if (id === userTokenId) refuse("it is your token, which setup never deletes, rolls or updates");
        if (method !== "DELETE" || m?.[2] !== undefined) refuse("setup updates and rolls no token");
        if (!signingIds.has(id)) refuse("setup deletes only the signing tokens it created");
      }
    }
    const reply = await api(method, path, body);
    if ((method === "GET" || method === "POST") && succeeded(reply) && TOKENS_LIST_PATH.test(sentPath(path) ?? "")) {
      const result = (reply.body as { result?: unknown } | null)?.result;
      if (Array.isArray(result)) result.forEach(learnSigning);
      else if (method === "POST" && typeof result === "object" && result !== null) learnSigning({ ...result, name: (body as { name?: unknown } | undefined)?.name });
    }
    return reply;
  };
}

const resultOf = <T>(r: ApiReply): T | undefined => (succeeded(r) ? (r.body as { result?: T }).result : undefined);

/** The accounts a token can see (`GET /accounts`), or the refusal. */
async function listAccounts(api: CloudflareApi): Promise<{ accounts: Account[] } | { refused: ApiReply }> {
  const r = await api("GET", "/accounts?per_page=50");
  const list = resultOf<unknown[]>(r);
  if (!Array.isArray(list)) return { refused: r };
  return {
    accounts: list.flatMap((a) => {
      const { id, name } = (a ?? {}) as { id?: unknown; name?: unknown };
      return typeof id === "string" && id !== "" ? [{ id, name: typeof name === "string" && name !== "" ? name : "(unnamed account)" }] : [];
    }),
  };
}

type Identified = { readonly token: Token } | { readonly problem: string };

/** Step 3: whether the token is valid and active, whose it is, and what it sees. Never prints. */
async function identify(value: string, api: CloudflareApi, preferredAccount: string | undefined): Promise<Identified> {
  const listed = await listAccounts(api);
  if ("refused" in listed) return { problem: `Cloudflare does not accept it as an API token (${describeFailure(listed.refused)}); it may be mistyped, cut short, deleted or expired` };
  const ordered = [...listed.accounts].sort((a, b) => Number(b.id === preferredAccount) - Number(a.id === preferredAccount));
  let owner: Account | undefined;
  let verified: { id?: unknown; status?: unknown } | undefined;
  for (const account of ordered) {
    verified = resultOf(await api("GET", `/accounts/${account.id}/tokens/verify`));
    if (verified !== undefined) {
      owner = account;
      break;
    }
  }
  const user = owner === undefined;
  if (user) verified = resultOf(await api("GET", "/user/tokens/verify"));
  if (verified === undefined || typeof verified.id !== "string" || verified.id === "") {
    return { problem: "Cloudflare could not verify it as an account or user API token" };
  }
  if (verified.status !== undefined && verified.status !== "active") return { problem: `the token is ${String(verified.status)}, not active` };
  if (listed.accounts.length === 0) return { problem: "the token can see no Cloudflare account" };
  return { token: { value, api, id: verified.id, ...(owner === undefined ? {} : { owner }), user, accounts: owner === undefined ? listed.accounts : [owner] } };
}

/** A missing group, as the dashboard's page shows it and as the API names it. */
const groupText = (g: PermissionGroup) => `  - ${dashboardName(g)} (account; API name "${g.name}")`;

/**
 * Runs the setup. Returns 0 when the account is set up and the hosts reachable; 1 when it stopped for
 * the user (with the exact link or command) or failed.
 */
export async function runCloudflareSetup(deps: CloudflareSetupDeps, io: ProvisionIo): Promise<ProvisionStatus> {
  const hidden = redactor();
  const say = (text = "") => io.stdout(hidden.redact(`${text}\n`));
  const warn = (text: string) => io.stderr(hidden.redact(`${COMMAND}: ${text}\n`));
  const stop = (text: string): ProvisionStatus => {
    say(text.trimEnd());
    return EXIT.failed;
  };
  try {
    return await run();
  } catch (error) {
    io.stderr(hidden.redact(`${COMMAND} failed: ${messageOf(error)}\n`));
    return EXIT.failed;
  }

  async function run(): Promise<ProvisionStatus> {
    const dir = deps.projectDir;

    // 0. Local setup first (idempotent). Its not-a-repository warning is step 1's.
    const ensured: EnsureIgnoredResult[] = [];
    const ensureIgnored = (d: string) => {
      const r = ensureEnvCloudflareIgnored(d);
      ensured.push(r);
      return r;
    };
    const outcomes = await (deps.localSetup ?? ((d, o) => runLocalSetup(d, o)))(dir, { ensureIgnored });
    const shown = outcomes.filter((o) => !(o.step === "gitignore" && o.result === "warned" && ensured[0] === "not-a-repo"));
    for (const text of describeLocalSetup(shown)) say(text);

    // 1. The credential's sources and notices, and the git warnings: never a failure.
    const settings: CloudflareSettings = readCloudflareSettings(deps.env, { ...(deps.home === undefined ? {} : { home: deps.home }), projectDir: dir });
    // The token and the account ID are never printed.
    for (const name of SETTING_NAMES) hidden.add(settings.values[name]);
    for (const notice of settings.notices) warn(`note: ${notice}`);
    try {
      for (const w of gitSafetyWarnings(inspectGitSafety(dir))) io.stderr(formatGitWarning(COMMAND, w));
    } catch {
      // the git check never fails setup
    }

    // 2. Both settings, or the template, where it goes and the link.
    const missing = SETTING_NAMES.filter((n) => settings.values[n] === undefined);
    if (missing.length > 0) return stop(noCredentialText(settings.filePath, missing));
    const tokenValue = settings.values.CLOUDFLARE_API_TOKEN ?? "";
    const accountId = settings.values.CLOUDFLARE_ACCOUNT_ID ?? "";
    say(`${TOKEN_SETTING}: from ${describeSource(settings, TOKEN_SETTING)}`);
    say(`${ACCOUNT_SETTING}: from ${describeSource(settings, ACCOUNT_SETTING)}`);

    if (deps.unreachable !== undefined) {
      io.stderr(hidden.redact(`${COMMAND} failed: ${deps.unreachable}\n`));
      return EXIT.failed;
    }

    // 3. The token, and the account it must see.
    const found = await identify(tokenValue, deps.apiFor(tokenValue), accountId);
    if ("problem" in found) return stop(tokenProblem(found.problem, settings));
    const token = found.token;
    for (const a of token.accounts) hidden.add(a.id);
    hidden.add(token.id);
    const account = token.accounts.find((a) => a.id === accountId);
    if (account === undefined) return stop(accountNotSeen(token.accounts, settings));
    say(`account: ${account.name}`);

    const protectedIds = new Set([...(deps.protectedTokenIds ?? []), ...(deps.env[PROTECTED_TOKEN_IDS_ENV] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")]);
    const api = guardTokenWrites(token.api, { protectedIds, userTokenId: token.id, onTokenId: (id) => hidden.add(id) });

    // 4. Its permissions, read with itself: more is fine and not mentioned; missing is named (DEC-0797).
    const own = await api("GET", token.user ? `/user/tokens/${token.id}` : `/accounts/${account.id}/tokens/${token.id}`);
    const details = resultOf<TokenDetails>(own);
    if (details === undefined || !Array.isArray(details.policies)) {
      const apiTokens = TOKEN.filter((g) => g.name === "Account API Tokens Write");
      return stop(
        [
          `${TOKEN_SETTING} cannot read its own permissions (${describeFailure(own)}), so it lacks this permission:`,
          ...apiTokens.map(groupText),
          "Setup could not check its other permissions. Make a token with every permission the framework needs:",
          tokenLinkBlock(),
          `Put it in ${TOKEN_SETTING} (in ${describeSource(settings, TOKEN_SETTING)}).`,
          NEXT_PROMPT,
        ].join("\n"),
      );
    }
    const lacking = comparePolicies(details.policies, TOKEN, { accountId: account.id, zoneId: "*" }).missing;
    if (lacking.length > 0) {
      return stop(
        [
          `${TOKEN_SETTING} lacks ${lacking.length === 1 ? "this permission" : `these ${String(lacking.length)} permissions`} on the account "${account.name}":`,
          ...lacking.map(groupText),
          "Add them to the token in the dashboard (Manage account, Account API tokens, the token, Edit), or make a new token with every permission the framework needs:",
          tokenLinkBlock(),
          NEXT_PROMPT,
        ].join("\n"),
      );
    }
    say(`${TOKEN_SETTING}: has every permission the framework needs`);

    // 5. The account setup, only when it is not current.
    let adminUrl: string | undefined;
    let changed = false;
    const status = await checkAccountSetup(api, account.id, ACCOUNT_SETUP_VERSION, deps.stepOptions ?? {});
    if (!status.current) {
      adminUrl = await setUpAccount(account);
      changed = true;
    }

    // 6. Network.
    const blocked = await networkProblems(account.id, api);

    // 7. Summary.
    say();
    say(changed ? "Cloudflare setup is complete." : "Everything is already set up and current: nothing to do.");
    say(`  account: ${account.name}`);
    say(`  account setup: current (setup version ${String(ACCOUNT_SETUP_VERSION)})`);
    // The only output not passed through the redaction whole: its text is, the URL appended after it is not (DEC-0686).
    if (adminUrl !== undefined) io.stdout(`${hidden.redact("  admin app (optional; status and cleanup pages): ")}${adminUrl}\n`);
    if (blocked.length > 0) {
      return stop(
        [
          `\nThis environment cannot reach ${blocked.join(", ")}, which deploy needs.`,
          "In a Claude Code cloud session, allow these hosts in the environment's network access settings (environment menu, Edit, Network access): api.cloudflare.com, *.r2.cloudflarestorage.com and *.workers.dev. Elsewhere, check the proxy or firewall.",
        ].join("\n"),
      );
    }
    say(`\nNext step: deploy a test stage: npm run deploy -- --target cloudflare --stage ${FIRST_TEST_STAGE} (or ask Claude to deploy a test stage).`);
    return EXIT.ok;

    /**
     * Step 5: the bootstrap (the subdomain, both OAuth clients with their secrets in Secrets Store,
     * the admin app; DEC-0684…DEC-0686), then the account setup (`runAccountSetup`, DEC-0798). Each
     * part finds what exists and makes only what is missing. Returns the admin app's URL.
     */
    async function setUpAccount(to: Account): Promise<string> {
      // The subdomain stays in the redaction (DEC-0590); only the summary's admin app line prints it (DEC-0686).
      const subdomain = await ensureSubdomain(api, to.id, deps.stepOptions?.newSubdomain);
      hidden.add(subdomain);
      const clients = await ensureOAuthClients(api, to.id, { subdomain, onSecret: (value) => hidden.add(value) });
      const both = (kinds: readonly ClientKind[]) => kinds.map((k) => CLIENT_NAMES[k]).join(" and ");
      if (clients.created.length > 0) say(`OAuth clients: created ${both(clients.created)}; their IDs and secrets are in Secrets Store`);
      if (clients.kept.length > 0) say(`OAuth clients: ${both(clients.kept)} already exist${clients.kept.length === 1 ? "s" : ""}, with their secrets in Secrets Store`);
      const url = await deployAdminApp(api, to.id, { storeId: await ensureStore(api, to.id), subdomain });
      say(`admin app: deployed (Worker ${APP_SCRIPTS.admin}), bound to the admin client's ID and secret in Secrets Store`);
      const done = await runAccountSetup(api, to.id, {
        authAppSource: deps.authAppSource ?? bundleAuthApp,
        frameworkVersion: deps.frameworkVersion ?? packageVersion(),
        now: () => (deps.now ?? (() => new Date()))().getTime(),
      });
      for (const line of done.lines) say(`account setup: ${line.split(done.authOrigin).join(`Worker ${APP_SCRIPTS.signin} on the account's workers.dev subdomain`)}`);
      return url;
    }
  }

  /**
   * Step 6: each host by its kind, never the account ID or the subdomain (DEC-0590). A failed read
   * or request counts as a blocked host, except a request layer's stop (`CloudflareRequestsStopped`,
   * DEC-0619), which is rethrown: nothing more is sent and the run fails with its message.
   */
  async function networkProblems(accountId: string, api: CloudflareApi): Promise<string[]> {
    const hosts: { what: string; url: string }[] = [
      { what: "the Cloudflare API (api.cloudflare.com)", url: "https://api.cloudflare.com/client/v4/" },
      { what: "the account's R2 storage host (<account ID>.r2.cloudflarestorage.com)", url: `https://${accountId}.r2.cloudflarestorage.com/` },
    ];
    try {
      const subdomain = await accountSubdomain(api, accountId);
      hidden.add(subdomain);
      // The bare subdomain has no DNS record; any Worker-style host under it resolves, and a
      // script that does not exist answers 404 from Cloudflare, which counts as reachable.
      hosts.push({ what: "the account's workers.dev subdomain (<subdomain>.workers.dev)", url: `https://${REACHABILITY_SCRIPT}.${subdomain}.workers.dev/` });
    } catch (error) {
      if (error instanceof CloudflareRequestsStopped) throw error;
      hosts.push({ what: "the account's workers.dev subdomain (it could not be read)", url: "" });
    }
    const blocked: string[] = [];
    for (const h of hosts) {
      try {
        if (h.url === "") throw new Error("unknown");
        await deps.reach(h.url);
      } catch (error) {
        if (error instanceof CloudflareRequestsStopped) throw error;
        blocked.push(h.what);
      }
    }
    return blocked;
  }
}

/** A token Cloudflare does not accept (bad paste): what is wrong, where it came from, and the link. */
function tokenProblem(problem: string, settings: CloudflareSettings): string {
  return [`${TOKEN_SETTING} (from ${describeSource(settings, TOKEN_SETTING)}): ${problem}.`, "Replace it with a token made from the link below.", tokenLinkBlock(), NEXT_PROMPT].join("\n");
}

/** The token cannot see the account `CLOUDFLARE_ACCOUNT_ID` names: the accounts it sees, by name only (DEC-0585). */
function accountNotSeen(accounts: readonly Account[], settings: CloudflareSettings): string {
  return [
    `${TOKEN_SETTING} cannot see the account ${ACCOUNT_SETTING} names (from ${describeSource(settings, ACCOUNT_SETTING)}). It sees ${accounts.length === 1 ? "this account" : `these ${String(accounts.length)} accounts`}:`,
    ...accounts.map((a, i) => `  ${String(i + 1)}. ${a.name}`),
    `Set ${ACCOUNT_SETTING} to the ID of the account to use, or make the token on that account from the link below. Setup does not print account IDs.`,
    ACCOUNT_ID_HELP,
    tokenLinkBlock(),
    NEXT_PROMPT,
  ].join("\n");
}
