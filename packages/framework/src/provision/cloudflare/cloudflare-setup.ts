/**
 * `cloudflare-setup`: the re-runnable Cloudflare setup (plan-setup-wizard §4.3, §3.2, §3.4;
 * DEC-0584…DEC-0590). Each run reads the current state and does only what is missing:
 *
 * 0. **Local setup** (`runLocalSetup`, DEC-0591): dependencies, local secrets, `.env.cloudflare` in
 *    `.gitignore` (git-safety's `ensureEnvCloudflareIgnored`).
 * 1. **Git**: the warnings of `gitSafetyWarnings` (not a repository, not ignored, tracked) on every
 *    run, set off by rule lines; never a failure.
 * 2. **Tokens** from the environment, then `.env.cloudflare` (`readCloudflareSettings`, which keeps
 *    the bootstrap token: DEC-0574's filter is for the everyday commands). Each is checked: valid and
 *    active (`GET /accounts/<a>/tokens/verify`, or `/user/tokens/verify` for a user token), its
 *    account (`GET /accounts`), and, for the everyday token, one read per permission
 *    (`probeEveryday`, account reads only). A bootstrap token with no expiry, or one more than
 *    1 day away (PAR-435), deletes itself at once and the run stops with its link (v0.2.0 plan §5.1
 *    step 1; DEC-0681).
 * 3. **No token to work with** (no everyday token and no usable bootstrap token): the requirements,
 *    links, template, where it goes and the next prompt; stop.
 * 4. **The account**: the everyday token's, else the bootstrap token's; several visible without
 *    `CLOUDFLARE_ACCOUNT_ID`: their names, and stop; a different account than the recorded
 *    `CLOUDFLARE_ACCOUNT_ID`: the account switch (§3.4).
 * 5–7. **With the bootstrap token: the bootstrap** (v0.2.0 plan §5.1): its own permissions checked
 *    (`BOOTSTRAP`); then it deletes itself at the end (its own ID, from its own verify call), its line
 *    in `.env.cloudflare` is commented out and its value is never written (DEC-0683). One whose ID is
 *    protected (`protectedTokenIds`) is not deleted: no DELETE is sent, its line is kept and a note
 *    says so. The bootstrap token does no account setup and never reads or changes the everyday
 *    token: both are the admin app's (plan §5.2; DEC-0682).
 *    Without it there is no email domain to ask for and no zone to look up (v0.2.0 plan §5.3;
 *    DEC-0689): the everyday token needs no zone permission.
 * 6. **The setup record**, with the everyday token (`checkAccountSetup`): current and the quick check
 *    passes: done. Otherwise what is missing, and the admin app (or, before it is deployed, the
 *    bootstrap link); stop.
 * 8. **Network**: `api.cloudflare.com`, the account's R2 storage host and its `workers.dev`
 *    subdomain, each named by its kind only.
 * 9. **Summary** and the next step; `CLOUDFLARE_ACCOUNT_ID` filled in (`CLOUDFLARE_EMAIL_DOMAIN` is
 *    neither read nor written since v0.2.0, DEC-0697).
 *
 * Output never holds a token value, an account ID or the `workers.dev` subdomain
 * (DEC-0573, DEC-0590): messages are written without them, and every line is also passed through a
 * redaction of each such value known to the run. Token writes go through a guard (DEC-0589, DEC-0618),
 * an allow-list: a DELETE only of the bootstrap token's own ID (in its last step, or at once for a
 * long-lived one) or of a signing
 * token the guard saw by its name (`prototype-r2-signing`, listed or just created by the signing
 * step), never a PUT (since v0.2.0 no token is updated, DEC-0682), and never a DELETE on an ID in
 * `protectedTokenIds`.
 * Exit status: 0 when the account is set up and reachable, 1 when the run stopped for something the
 * user must do or failed (DEC-0588).
 */
import { formatGitWarning } from "../../cli/cloudflare-settings.js";
import { describeLocalSetup, runLocalSetup, type EnsureIgnoredResult, type LocalSetupDeps, type LocalSetupOutcome } from "../core/local-setup.js";
import { EXIT, messageOf, type ProvisionIo, type ProvisionStatus } from "../core/output.js";
import { accountSubdomain } from "./account.js";
import { CloudflareRequestsStopped, describeFailure, sentPath, succeeded, type ApiReply, type CloudflareApi } from "./api.js";
import type { Environment } from "./environment.js";
import { ensureEnvCloudflareIgnored, gitSafetyWarnings, inspectGitSafety } from "./git-safety.js";
import { ACCOUNT_SETUP_VERSION, BOOTSTRAP, comparePolicies, deepLink, PERMISSIONS_VERSION, probeEveryday, TOKEN_NAMES, type PermissionGroup, type TokenDetails } from "./permissions.js";
import { deployAdminApp } from "./admin-app-deploy.js";
import { APP_SCRIPTS, CLIENT_NAMES, ensureOAuthClients, ensureSubdomain, type ClientKind } from "./oauth-clients.js";
import { ensureStore } from "./secrets-store.js";
import { SIGNING_TOKEN_NAME } from "./r2-token.js";
import { checkAccountSetup, type SetupStepOptions } from "./setup-steps.js";
import { commentOutBootstrap, ENV_CLOUDFLARE_FILE, ENV_CLOUDFLARE_TEMPLATE, fillInSettings, readCloudflareSettings, writeTemplateIfAbsent, type CloudflareSettings } from "./token-sources.js";

const COMMAND = "cloudflare-setup";

/** The settings that hold the two tokens. */
export const BOOTSTRAP_SETTING = "CLOUDFLARE_BOOTSTRAP_TOKEN";
export const EVERYDAY_SETTING = "CLOUDFLARE_API_TOKEN";
type Slot = typeof BOOTSTRAP_SETTING | typeof EVERYDAY_SETTING;

/** The phrase that runs the setup again in a new session (plan §3.2). */
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
  /** The process environment, not yet merged with `.env.cloudflare`. */
  readonly env: Environment;
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
  /** The setup steps' options (waits, the new subdomain). */
  readonly stepOptions?: Omit<SetupStepOptions, "note">;
  readonly frameworkVersion?: string;
  readonly now?: () => Date;
  /** Why this process cannot reach Cloudflare (`cloudProcessProblems`): checked before the first request, after the steps that need none. */
  readonly unreachable?: string;
  /** A Claude Code cloud session (default: `CLAUDE_CODE_REMOTE=true` in `env`). */
  readonly cloudSession?: boolean;
}

export interface CloudflareSetupRequest {
  /** `--switch-account`: go on with the tokens' account after the account-switch explanation. */
  readonly switchAccount?: boolean;
}

interface Account {
  readonly id: string;
  readonly name: string;
}

interface Token {
  readonly slot: Slot;
  readonly value: string;
  readonly api: CloudflareApi;
  readonly id: string;
  readonly expiresOn?: string;
  /** The account that owns an account API token. */
  readonly owner?: Account;
  /** A user API token (made under My Profile). */
  readonly user: boolean;
  /** The accounts the token can see. */
  readonly accounts: readonly Account[];
}

const TITLE: Readonly<Record<Slot, string>> = {
  [BOOTSTRAP_SETTING]: `${BOOTSTRAP_SETTING} (the bootstrap token)`,
  [EVERYDAY_SETTING]: `${EVERYDAY_SETTING} (the everyday token)`,
};

/** What to choose on the bootstrap link's page (plan §2, §3.2): the link cannot set the account or the expiry. */
const BOOTSTRAP_PAGE_CHOICES =
  "On the page: pick your account if the dashboard asks; under TTL, set an end date no more than 1 day away (setup deletes a bootstrap token that lives longer, or has no end date, at once). Then choose Continue to summary, then Create Token, and copy the token.";

/**
 * The everyday token's remedy since v0.2.0: the admin app's Everyday token page, never a dashboard
 * link (SETUP-REQ-003 as amended, DEC-0697; plan-v0.2.0 §5.2 page 2).
 */
export const EVERYDAY_PAGE = "Make it, or update it, on the Everyday token page of the admin app (open the admin app and sign in), then put it in CLOUDFLARE_API_TOKEN.";

/** PAR-435: the longest a bootstrap token may still have to live when setup reads it, in milliseconds (1 day; supersedes PAR-380's 7 days). */
export const BOOTSTRAP_MAX_LIFETIME_MS = 86_400_000;

/**
 * Why a bootstrap token's expiry (`expires_on` from its verify call) is refused (DEC-0681): none,
 * one that cannot be read, or one more than `BOOTSTRAP_MAX_LIFETIME_MS` after `now`. Exactly 1 day
 * away is accepted. `undefined` when it is accepted.
 */
export function bootstrapExpiryProblem(expiresOn: string | undefined, now: Date): string | undefined {
  if (expiresOn === undefined) return "it has no expiry";
  const at = Date.parse(expiresOn);
  if (Number.isNaN(at)) return "its expiry cannot be read";
  if (at - now.getTime() > BOOTSTRAP_MAX_LIFETIME_MS) return `it expires more than 1 day from now (${new Date(at).toISOString()})`;
  return undefined;
}

/** Where the account setup and the everyday token's permissions are made since v0.2.0 (plan §5.2; DEC-0682). */
export const ADMIN_APP_NEXT =
  "Open the admin app and sign in: its Account setup page sets the account up, and its Everyday token page makes or updates the everyday token. If the admin app is not deployed yet, run this setup once with a bootstrap token first:";

/** The bootstrap token's link with what to choose on its page. The everyday token has no link since v0.2.0 (`EVERYDAY_PAGE`). */
export function bootstrapLinkBlock(): string {
  return `The bootstrap token (used once by this setup, which then deletes it), named ${TOKEN_NAMES.bootstrap}:\n  ${deepLink("bootstrap")}\n  ${BOOTSTRAP_PAGE_CHOICES}\n`;
}

/** Where the values go (plan §3.2): the cloud session's environment settings, or the command line's file or environment. */
export const WHERE_IT_GOES = [
  "Where the values go:",
  "  - In a Claude Code cloud session: open the environment menu, choose Edit, and add each NAME=value line under Environment variables; save, then start a new session.",
  `  - On the command line: in the file ${ENV_CLOUDFLARE_FILE} in the project folder (which holds the template), or in the environment.`,
].join("\n") + "\n";

/** The whole no-token output (plan §3.2, §4.3 step 3). */
export function noTokensText(): string {
  return [
    "Cloudflare setup starts with a bootstrap token, made from a pre-filled dashboard link. Setup never prints a token.\n",
    `1. ${bootstrapLinkBlock()}`,
    `2. The everyday token (used by deploy and the other commands), named ${TOKEN_NAMES.everyday}: the admin app makes it on its Everyday token page once this setup has deployed the admin app. Open the admin app, sign in, make the token there and put it in CLOUDFLARE_API_TOKEN.\n`,
    `Fill in this template:\n${ENV_CLOUDFLARE_TEMPLATE}`,
    WHERE_IT_GOES,
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
 * The token write guard (DEC-0589, DEC-0613): every request through `api` other than a GET that
 * names an API token's ID is checked before it is sent. The path judged is the one sent
 * (`sentPath`: `API_BASE + path` as the URL parser normalises it, each segment decoded), and IDs
 * and the path's names are compared in any case. Refused: any such request on a protected ID; any
 * method but DELETE (a PUT included: no token is updated since v0.2.0, DEC-0682), and any sub-path
 * (the value roll); a DELETE of the everyday token; a DELETE of the bootstrap token outside its
 * self-delete; a DELETE of any other ID unless the guard saw it as a signing token (DEC-0618); a request whose
 * URL cannot be parsed. Creating a token (`POST …/tokens`, the signing step) names no ID. The
 * signing step's rotation finds its old tokens by name (`GET …/tokens`) and may delete the token it
 * just created when its record cannot be written, so the guard learns the IDs of tokens named
 * `SIGNING_TOKEN_NAME` from the token lists and creates that pass through it. Every token ID those
 * answers name goes to `onTokenId` (the run's redaction, SETUP-REQ-007).
 */
export function guardTokenWrites(
  api: CloudflareApi,
  rules: { readonly protectedIds: ReadonlySet<string>; readonly everydayId?: string; readonly bootstrapId?: string; readonly selfDeleteArmed: () => boolean; readonly onTokenId?: (id: string) => void },
): CloudflareApi {
  const protectedIds = new Set([...rules.protectedIds].map((id) => id.toLowerCase()));
  const everydayId = rules.everydayId?.toLowerCase();
  const bootstrapId = rules.bootstrapId?.toLowerCase();
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
        throw new Error(`setup refused to ${method === "DELETE" ? "delete" : "update"} an API token: ${why}`);
      };
      const sent = sentPath(path);
      if (sent === undefined) refuse("its URL cannot be read");
      const m = TOKEN_PATH.exec(sent ?? "");
      const id = m?.[1]?.toLowerCase();
      if (id !== undefined && !NOT_TOKEN_IDS.has(id)) {
        if (protectedIds.has(id)) refuse("its ID is protected");
        // Since v0.2.0 setup updates no token (DEC-0682): the everyday token's permissions are the admin app's.
        if (method !== "DELETE" || m?.[2] !== undefined) refuse("setup only deletes the bootstrap token and its own signing tokens, and updates no token");
        if (method === "DELETE" && id === everydayId) refuse("it is the everyday token");
        if (method === "DELETE" && id === bootstrapId && !rules.selfDeleteArmed()) refuse("the bootstrap token is deleted only by its own last step");
        if (method === "DELETE" && id !== bootstrapId && !signingIds.has(id)) refuse("setup deletes only the bootstrap token and its own signing tokens");
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

/** Step 2: whether the token is valid and active, whose it is, and what it sees. Never prints. */
async function identify(slot: Slot, value: string, api: CloudflareApi, preferredAccount: string | undefined): Promise<Identified> {
  const listed = await listAccounts(api);
  if ("refused" in listed) return { problem: `Cloudflare does not accept it as an API token (${describeFailure(listed.refused)}); it may be mistyped, cut short, deleted or expired` };
  const ordered = [...listed.accounts].sort((a, b) => Number(b.id === preferredAccount) - Number(a.id === preferredAccount));
  let owner: Account | undefined;
  let verified: { id?: unknown; status?: unknown; expires_on?: unknown } | undefined;
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
  return {
    token: {
      slot,
      value,
      api,
      id: verified.id,
      ...(typeof verified.expires_on === "string" && verified.expires_on !== "" ? { expiresOn: verified.expires_on } : {}),
      ...(owner === undefined ? {} : { owner }),
      user,
      accounts: owner === undefined ? listed.accounts : [owner],
    },
  };
}

const groupNames = (groups: readonly PermissionGroup[]) => groups.map((g) => `"${g.name}"`).join(", ");

/**
 * Runs the setup. Returns 0 when the account is set up, its tokens current and the hosts
 * reachable; 1 when it stopped for the user (with the exact link or command) or failed.
 */
export async function runCloudflareSetup(deps: CloudflareSetupDeps, request: CloudflareSetupRequest, io: ProvisionIo): Promise<ProvisionStatus> {
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
    const cloudSession = deps.cloudSession ?? deps.env.CLAUDE_CODE_REMOTE === "true";

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

    // 1. Git: warnings on every run, never a failure.
    let settings: CloudflareSettings;
    try {
      settings = readCloudflareSettings(dir, deps.env);
    } catch (error) {
      settings = { values: {}, sources: {}, notices: [`${ENV_CLOUDFLARE_FILE} could not be read (${messageOf(error)})`], fileExists: false };
    }
    // The tokens and the account ID are never printed.
    for (const name of [BOOTSTRAP_SETTING, EVERYDAY_SETTING, "CLOUDFLARE_ACCOUNT_ID"] as const) hidden.add(settings.values[name]);
    for (const notice of settings.notices) warn(`note: ${notice}`);
    try {
      for (const w of gitSafetyWarnings(inspectGitSafety(dir))) io.stderr(formatGitWarning(COMMAND, w));
    } catch {
      // the git check never fails setup
    }

    // 2. Tokens.
    const bootValue = settings.values.CLOUDFLARE_BOOTSTRAP_TOKEN;
    const everydayValue = settings.values.CLOUDFLARE_API_TOKEN;
    const configuredAccount = settings.values.CLOUDFLARE_ACCOUNT_ID;
    if (bootValue === undefined && everydayValue === undefined) {
      // 3. No token at all: plan §3.2.
      try {
        writeTemplateIfAbsent(dir);
      } catch (error) {
        warn(`note: ${ENV_CLOUDFLARE_FILE} could not be created (${messageOf(error)}); create it yourself from the template below`);
      }
      return stop(noTokensText());
    }

    if (deps.unreachable !== undefined) {
      io.stderr(hidden.redact(`${COMMAND} failed: ${deps.unreachable}\n`));
      return EXIT.failed;
    }
    const protectedIds = new Set([...(deps.protectedTokenIds ?? []), ...(deps.env[PROTECTED_TOKEN_IDS_ENV] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")]);
    /** In any case, as the write guard compares them. */
    const isProtected = (id: string) => [...protectedIds].some((p) => p.toLowerCase() === id.toLowerCase());
    const problems: { slot: Slot; text: string }[] = [];
    // A bootstrap token Cloudflare no longer accepts (setup deleted it; the cloud environment still
    // holds it) matters only when the run needs one (DEC-0588): then it is named with its link.
    let unusableBootstrap: string | undefined;
    const identifyIn = async (slot: Slot, value: string | undefined): Promise<Token | undefined> => {
      if (value === undefined) return undefined;
      const found = await identify(slot, value, deps.apiFor(value), configuredAccount);
      if ("problem" in found) {
        if (slot === BOOTSTRAP_SETTING) unusableBootstrap = found.problem;
        else problems.push({ slot, text: found.problem });
        return undefined;
      }
      for (const a of found.token.accounts) hidden.add(a.id);
      hidden.add(found.token.id);
      return found.token;
    };
    let boot = bootValue !== undefined && bootValue === everydayValue ? undefined : await identifyIn(BOOTSTRAP_SETTING, bootValue);
    if (bootValue !== undefined && bootValue === everydayValue) problems.push({ slot: BOOTSTRAP_SETTING, text: `it holds the same token as ${EVERYDAY_SETTING}; the two must be different tokens, each made from its own link` });
    const everyday = await identifyIn(EVERYDAY_SETTING, everydayValue);
    if (boot?.user === true) {
      problems.push({
        slot: BOOTSTRAP_SETTING,
        text: "it is a user API token (made under My Profile), not an account API token made from the bootstrap link; setup deletes the bootstrap token when it is done, so it accepts only one made from the link",
      });
      boot = undefined;
    }
    if (boot !== undefined && everyday !== undefined && boot.id === everyday.id) {
      problems.push({ slot: BOOTSTRAP_SETTING, text: `it is the same token as ${EVERYDAY_SETTING}` });
      boot = undefined;
    }

    let selfDeleteArmed = false;
    const guard = (api: CloudflareApi) =>
      guardTokenWrites(api, {
        protectedIds,
        ...(everyday === undefined ? {} : { everydayId: everyday.id }),
        ...(boot === undefined ? {} : { bootstrapId: boot.id }),
        selfDeleteArmed: () => selfDeleteArmed,
        onTokenId: (id) => hidden.add(id),
      });
    const bootApi = boot === undefined ? undefined : guard(boot.api);

    // The bootstrap token's expiry (v0.2.0 plan §5.1 step 1; DEC-0681): none, or more than 1 day
    // away (PAR-435), and it is deleted at once, before anything else is checked or used. Its own
    // details are read first: a token that cannot read them (the everyday token pasted there) lacks
    // "Account API Tokens Write", so it could not delete itself either.
    let bootPolicies: TokenDetails["policies"] = [];
    if (boot !== undefined && bootApi !== undefined) {
      const own = await bootApi("GET", `/accounts/${boot.owner?.id ?? ""}/tokens/${boot.id}`);
      const ownDetails = resultOf<TokenDetails>(own);
      if (ownDetails === undefined || !Array.isArray(ownDetails.policies)) {
        problems.push({ slot: BOOTSTRAP_SETTING, text: `it cannot read API tokens (${describeFailure(own)}), so it lacks "Account API Tokens Write": was the everyday token pasted there?` });
        boot = undefined;
      } else {
        bootPolicies = ownDetails.policies;
        const tooLong = bootstrapExpiryProblem(boot.expiresOn, (deps.now ?? (() => new Date()))());
        if (tooLong !== undefined) return refuseLongLived(boot, bootApi, tooLong);
      }
    }

    // 3. No token to work with: no everyday token, and no usable bootstrap token. Its link, the template and where it goes.
    if (everydayValue === undefined && boot === undefined) {
      const lines = [`${EVERYDAY_SETTING} is not set. Setup needs the everyday token too.`, `${EVERYDAY_PAGE}\n`];
      for (const p of problems) lines.push(problemText(p.slot, p.text));
      if (unusableBootstrap !== undefined) lines.push(problemText(BOOTSTRAP_SETTING, unusableBootstrap));
      else if (problems.length === 0) lines.push(`If the admin app is not deployed yet, run this setup once with a bootstrap token first:\n${bootstrapLinkBlock()}`);
      lines.push(`Fill in this template:\n${ENV_CLOUDFLARE_TEMPLATE}`, WHERE_IT_GOES, NEXT_PROMPT);
      return stop(lines.join("\n"));
    }
    if (problems.length > 0) return stop([...problems.map((p) => problemText(p.slot, p.text)), NEXT_PROMPT].join("\n"));
    // Either token is usable here: the bootstrap token alone runs the bootstrap (v0.2.0 plan §5.1).
    const chooser = everyday ?? boot;
    if (chooser === undefined) return stop(NEXT_PROMPT);

    // 4. The account: the everyday token's (else the bootstrap token's), checked against CLOUDFLARE_ACCOUNT_ID (DEC-0585).
    const candidates = chooser.accounts;
    let account: Account | undefined;
    let switched = false;
    if (configuredAccount !== undefined) {
      account = candidates.find((a) => a.id === configuredAccount);
      if (account === undefined) {
        if (candidates.length > 1) return stop(chooseAccountText(candidates, true));
        account = candidates[0];
        if (account === undefined) return stop(problemText(chooser.slot, "it can see no Cloudflare account"));
        if (request.switchAccount !== true) return stop(accountSwitchText(account));
        switched = true;
        say(`switching this project to the account "${account.name}" (--switch-account)`);
      }
    } else if (candidates.length === 1) {
      account = candidates[0];
    } else {
      return stop(chooseAccountText(candidates, false));
    }
    if (account === undefined) return stop(problemText(chooser.slot, "it can see no Cloudflare account"));
    const accountId = account.id;
    hidden.add(accountId);
    if (boot !== undefined && !boot.accounts.some((a) => a.id === accountId)) {
      const theirs = boot.owner?.name ?? "another account";
      return stop([problemText(BOOTSTRAP_SETTING, `it belongs to the account "${theirs}", not "${account.name}", which ${EVERYDAY_SETTING} uses; make it on that account`), NEXT_PROMPT].join("\n"));
    }
    say(`account: ${account.name}`);

    // 5–7 with the bootstrap token: the bootstrap (v0.2.0 plan §5.1); the everyday token is left as it is.
    if (boot !== undefined && bootApi !== undefined) return bootstrap(boot, bootApi, account, switched);
    if (everyday === undefined) return stop(NEXT_PROMPT);
    const everydayApi = guard(everyday.api);

    // 2 (cont.). The everyday token's quick check: account reads only, no zone (DEC-0689).
    const probe = await probeEveryday(everydayApi, { accountId });
    const failedProbe = probe.filter((r) => !r.ok);
    const probeText = failedProbe.map((r) => `"${r.group.name}" (HTTP ${String(r.status)})`).join(", ");

    let changed = false;
    const everydayState = `passed the quick check (one read per permission of list version ${String(PERMISSIONS_VERSION)})`;
    // 6. The setup record, with the everyday token. Since v0.2.0 the account setup and the everyday
    // token's permissions are the admin app's (plan §5.2), not the bootstrap token's (DEC-0682).
    let reasons: string[];
    try {
      const status = await checkAccountSetup(everydayApi, accountId, ACCOUNT_SETUP_VERSION, deps.stepOptions ?? {});
      reasons = [];
      if (status.record === undefined) reasons.push("the account has not been set up by this setup yet");
      else if (status.record.setupVersion < ACCOUNT_SETUP_VERSION) reasons.push(`the account's setup is at version ${String(status.record.setupVersion)}, and this release needs version ${String(ACCOUNT_SETUP_VERSION)}`);
      if (status.missing.length > 0) reasons.push(`these setup steps are missing: ${status.missing.join(", ")}`);
      if (reasons.length === 0 && !status.current) reasons.push("the account's setup is not current");
    } catch (error) {
      // A request layer's stop is not unreadable setup (DEC-0619): the run ends with it.
      if (error instanceof CloudflareRequestsStopped) throw error;
      reasons = [`the account's setup could not be read with ${EVERYDAY_SETTING} (${messageOf(error)})`];
    }
    if (failedProbe.length > 0) reasons.push(`${EVERYDAY_SETTING} failed the quick check for ${probeText}`);
    if (reasons.length > 0) {
      return stop(
        [
          `This needs the admin app:\n${reasons.map((r) => `  - ${r}`).join("\n")}\n`,
          // A bootstrap token set but not accepted is a bad paste: only its remedy (SETUP-AC-003).
          ...(unusableBootstrap === undefined ? [ADMIN_APP_NEXT, bootstrapLinkBlock()] : [problemText(BOOTSTRAP_SETTING, unusableBootstrap)]),
          WHERE_IT_GOES,
          NEXT_PROMPT,
        ].join("\n"),
      );
    }
    const setupState = `current (setup version ${String(ACCOUNT_SETUP_VERSION)})`;
    if (unusableBootstrap !== undefined) {
      const where = settings.sources.CLOUDFLARE_BOOTSTRAP_TOKEN === "file" ? ENV_CLOUDFLARE_FILE : cloudSession ? "the cloud environment's settings (environment menu, Edit, Environment variables)" : "the environment";
      warn(`note: ${BOOTSTRAP_SETTING} is no longer a valid token (setup deletes it when it is done). Nothing needs it now: remove it from ${where}.`);
    }

    // 9 (record). CLOUDFLARE_ACCOUNT_ID filled in, so copying the file starts the next project.
    if (fillIn({ CLOUDFLARE_ACCOUNT_ID: accountId }, account, switched)) changed = true;

    // 8. Network.
    const blocked = await networkProblems(accountId, everydayApi);

    // 9. Summary.
    say();
    say(changed ? "Cloudflare setup is complete." : "Everything is already set up and current: nothing to do.");
    say(`  account: ${account.name}`);
    say(`  account setup: ${setupState}`);
    say(`  everyday token: ${everydayState}`);
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

    /** Records the values in `.env.cloudflare` (an account switch replaces the account ID there); true when the file changed. */
    function fillIn(values: Partial<Record<"CLOUDFLARE_ACCOUNT_ID", string>>, to: Account, switchedTo: boolean): boolean {
      if (switchedTo && settings.sources.CLOUDFLARE_ACCOUNT_ID === "environment") {
        say(`Change CLOUDFLARE_ACCOUNT_ID in the environment to the account "${to.name}"'s ID (environment settings in a cloud session); it still names the old account.`);
      }
      try {
        const filled = fillInSettings(dir, values, switchedTo && settings.sources.CLOUDFLARE_ACCOUNT_ID === "file" ? { replace: ["CLOUDFLARE_ACCOUNT_ID"] } : {});
        if (filled.length > 0) say(`recorded ${filled.join(" and ")} in ${ENV_CLOUDFLARE_FILE}`);
        return filled.length > 0;
      } catch (error) {
        warn(`could not record ${Object.keys(values).join(" and ")} in ${ENV_CLOUDFLARE_FILE} (${messageOf(error)})`);
        return false;
      }
    }

    /**
     * The bootstrap (v0.2.0 plan §5.1): the token's own permissions, then (DEC-0683) it deletes
     * itself at the end of the run, its line is commented out and its value is never written. The
     * everyday token and the account setup are not the bootstrap token's (DEC-0682).
     */
    async function bootstrap(token: Token, api: CloudflareApi, to: Account, switchedTo: boolean): Promise<ProvisionStatus> {
      const missing = comparePolicies(bootPolicies, BOOTSTRAP, { accountId: to.id, zoneId: "*" }).missing;
      if (missing.length > 0) return stop([problemText(BOOTSTRAP_SETTING, `it lacks ${groupNames(missing)} on this account`), NEXT_PROMPT].join("\n"));

      // Step 2: both OAuth clients, each secret straight into Secrets Store (DEC-0684, DEC-0685).
      // A failure throws: the run fails before the self-delete, so the token stays for the next run.
      // The subdomain stays in the redaction (DEC-0590); only step 5's two lines print the admin app's URL past it (DEC-0686).
      const subdomain = await ensureSubdomain(api, to.id, deps.stepOptions?.newSubdomain);
      hidden.add(subdomain);
      const clients = await ensureOAuthClients(api, to.id, { subdomain, onSecret: (value) => hidden.add(value) });
      const both = (kinds: readonly ClientKind[]) => kinds.map((k) => CLIENT_NAMES[k]).join(" and ");
      if (clients.created.length > 0) say(`OAuth clients: created ${both(clients.created)}; their IDs and secrets are in Secrets Store`);
      if (clients.kept.length > 0) say(`OAuth clients: ${both(clients.kept)} already exist${clients.kept.length === 1 ? "s" : ""}, with their secrets in Secrets Store`);

      // Step 3: the admin app, deployed and bound to the admin client (DEC-0686).
      const adminUrl = await deployAdminApp(api, to.id, { storeId: await ensureStore(api, to.id), subdomain });
      say(`admin app: deployed (Worker ${APP_SCRIPTS.admin}), bound to the admin client's ID and secret in Secrets Store`);

      // The bootstrap token deletes itself last: its own ID, from its own verify call, never another.
      // A protected one does not: no DELETE is sent (the guard would refuse it) and its line stays.
      if (isProtected(token.id)) {
        say(`note: the bootstrap token is protected, so setup did not delete it; ${BOOTSTRAP_SETTING} is kept as it is`);
      } else {
        const deleted = await selfDelete(token, api);
        if (!succeeded(deleted)) {
          return stop(`The bootstrap token could not delete itself (${describeFailure(deleted)}). Delete it in the dashboard (Manage account, Account API tokens, ${TOKEN_NAMES.bootstrap}), then remove ${BOOTSTRAP_SETTING}.`);
        }
        say("the bootstrap token deleted itself");
        afterSelfDelete();
      }
      fillIn({ CLOUDFLARE_ACCOUNT_ID: to.id }, to, switchedTo);
      say();
      // Step 5: the admin app's URL and the next step.
      say("The Cloudflare bootstrap is complete.");
      say(`  account: ${to.name}`);
      // The only output not passed through the redaction whole: its text is, the URL appended after it is not.
      const sayWithUrl = (text: string) => io.stdout(`${hidden.redact(text)}${adminUrl}\n`);
      sayWithUrl("  admin app: ");
      sayWithUrl("\nNext step: open the admin app and sign in: ");
      return EXIT.ok;
    }

    /**
     * A bootstrap token with no expiry or one more than 1 day away (DEC-0681): deleted at once,
     * before anything else is checked or used, with how to make a new one. A protected one is
     * neither deleted nor used.
     */
    async function refuseLongLived(token: Token, api: CloudflareApi, why: string): Promise<ProvisionStatus> {
      const remake = `Make a new bootstrap token with an expiry of 1 day or less from this link, put it in ${BOOTSTRAP_SETTING} and run setup again:\n  ${deepLink("bootstrap")}\n  ${BOOTSTRAP_PAGE_CHOICES}\n`;
      const head = `${TITLE[BOOTSTRAP_SETTING]}: ${why}, and a bootstrap token may live 1 day at most.`;
      if (isProtected(token.id)) return stop(`${head} Its ID is protected, so setup neither deleted nor used it.\n${remake}\n${NEXT_PROMPT}`);
      const deleted = await selfDelete(token, api);
      if (!succeeded(deleted)) {
        return stop(`${head} Setup could not delete it (${describeFailure(deleted)}): delete it in the dashboard (Manage account, Account API tokens, ${TOKEN_NAMES.bootstrap}).\n${remake}\n${NEXT_PROMPT}`);
      }
      say(`${head} Setup deleted it at once and used it for nothing else.`);
      afterSelfDelete();
      return stop(`${remake}\n${NEXT_PROMPT}`);
    }

    /** The bootstrap token's only DELETE: its own ID on its own account (the guard allows it only while armed). */
    async function selfDelete(token: Token, api: CloudflareApi): Promise<ApiReply> {
      selfDeleteArmed = true;
      try {
        return await api("DELETE", `/accounts/${token.owner?.id ?? ""}/tokens/${token.id}`);
      } finally {
        selfDeleteArmed = false;
      }
    }

    /** After the self-delete: its line in `.env.cloudflare` commented out (the value is never written), and where else to remove it. */
    function afterSelfDelete(): void {
      try {
        if (commentOutBootstrap(dir)) say(`commented out ${BOOTSTRAP_SETTING} in ${ENV_CLOUDFLARE_FILE}`);
      } catch (error) {
        warn(`could not comment out ${BOOTSTRAP_SETTING} in ${ENV_CLOUDFLARE_FILE} (${messageOf(error)}); the token is deleted, so remove the line yourself`);
      }
      if (settings.sources.CLOUDFLARE_BOOTSTRAP_TOKEN === "environment") {
        say(
          cloudSession
            ? `You can now remove ${BOOTSTRAP_SETTING} from the cloud environment's settings (environment menu, Edit, Environment variables). The token is already deleted: until you remove it, later runs note that it is no longer valid and go on.`
            : `You can now remove ${BOOTSTRAP_SETTING} from the environment. The token is already deleted: until you remove it, later runs note that it is no longer valid and go on.`,
        );
      }
    }
  }

  /**
   * Step 8: each host by its kind, never the account ID or the subdomain (DEC-0590). A failed read
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

/**
 * One token's problem (bad paste, plan §3.4): which token, what is wrong, and only that token's
 * remedy: the bootstrap link, or the admin app's Everyday token page (SETUP-AC-003, DEC-0697).
 */
function problemText(slot: Slot, text: string): string {
  if (slot === EVERYDAY_SETTING) return `${TITLE[slot]}: ${text}.\n${EVERYDAY_PAGE}\n`;
  return `${TITLE[slot]}: ${text}.\nReplace it with a new token from this link:\n  ${deepLink("bootstrap")}\n  ${BOOTSTRAP_PAGE_CHOICES}\n`;
}

/** Several accounts: their names only, never their IDs (DEC-0585). */
function chooseAccountText(accounts: readonly Account[], configured: boolean): string {
  return [
    `${EVERYDAY_SETTING} can see ${String(accounts.length)} Cloudflare accounts${configured ? ", and none is the one CLOUDFLARE_ACCOUNT_ID names" : ""}:`,
    ...accounts.map((a, i) => `  ${String(i + 1)}. ${a.name}`),
    "Choose one: open https://dash.cloudflare.com, select that account, and copy its Account ID (on the account's home page, or from the address bar: dash.cloudflare.com/<account ID>/…).",
    `Set CLOUDFLARE_ACCOUNT_ID to it in ${ENV_CLOUDFLARE_FILE} (or in the environment). Setup does not print account IDs.`,
    NEXT_PROMPT,
  ].join("\n");
}

/** The account switch (plan §3.4). */
function accountSwitchText(account: Account): string {
  return [
    `The tokens belong to the account "${account.name}", but this project is set up for another account (CLOUDFLARE_ACCOUNT_ID).`,
    "Stages deployed on the old account keep running, with their data and costs, until they are removed. Remove them while the old everyday token still works: with it as CLOUDFLARE_API_TOKEN, run",
    "  npm run remove -- --target cloudflare --stage <stage>",
    "for each stage (a production stage also needs --confirm-production <stage>).",
    `To switch this project to "${account.name}", run: npm run cloudflare-setup -- --switch-account`,
    "Setup then sets the new account up as needed and records its ID in CLOUDFLARE_ACCOUNT_ID.",
  ].join("\n");
}
