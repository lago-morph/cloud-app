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
 *    (`probeEveryday`) once the zone is known.
 * 3. **No everyday token**: plan §3.2's requirements, links, template, where it goes and the next
 *    prompt; stop.
 * 4. **The account**: several visible without `CLOUDFLARE_ACCOUNT_ID`: their names, and stop; a
 *    different account than the recorded `CLOUDFLARE_ACCOUNT_ID`: the account switch (§3.4); the plan
 *    (`GET /accounts/<a>/subscriptions`, "Billing Read"): Workers Free stops.
 * 5. **The email domain**: `--email-domain`, else `CLOUDFLARE_EMAIL_DOMAIN`, else the account's zone
 *    names, and stop.
 * 6. **The setup record**, with the everyday token (`checkAccountSetup`): current and the quick check
 *    passes: done. Otherwise the bootstrap token is needed: without it, only its link; stop.
 * 7. **With the bootstrap token**: its own permissions checked; the missing setup steps applied and
 *    the record written (`applySetupSteps`); the everyday token checked exactly once with the
 *    bootstrap token (`GET …/tokens/<id>`, `comparePolicies`) and missing permissions added in place
 *    (`PUT …/tokens/<id>`, value unchanged); a token of the wrong account or zone, or with a deny, is
 *    explained with the everyday link only. Then the bootstrap token deletes itself (its own ID, from
 *    its own verify call) and its line in `.env.cloudflare` is commented out.
 * 8. **Network**: `api.cloudflare.com`, the account's R2 storage host and its `workers.dev`
 *    subdomain, each named by its kind only.
 * 9. **Summary** and the next step; `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_DOMAIN` filled in.
 *
 * Output never holds a token value, an account ID, a zone ID or the `workers.dev` subdomain
 * (DEC-0573, DEC-0590): messages are written without them, and every line is also passed through a
 * redaction of each such value known to the run. Token writes go through a guard (DEC-0589): a DELETE
 * only of the bootstrap token's own ID (or setup's own signing tokens), a PUT only of the everyday
 * token's ID, and never either on an ID in `protectedTokenIds`.
 * Exit status: 0 when the account is set up and reachable, 1 when the run stopped for something the
 * user must do or failed (DEC-0588).
 */
import { formatGitWarning } from "../../cli/cloudflare-settings.js";
import { emailDomainProblem } from "../core/account-settings.js";
import { describeLocalSetup, runLocalSetup, type EnsureIgnoredResult, type LocalSetupDeps, type LocalSetupOutcome } from "../core/local-setup.js";
import { EXIT, messageOf, type ProvisionIo, type ProvisionStatus } from "../core/output.js";
import { accountSubdomain } from "./account.js";
import { describeFailure, sentPath, succeeded, type ApiReply, type CloudflareApi } from "./api.js";
import { zoneCandidates } from "./email.js";
import type { Environment } from "./environment.js";
import { ensureEnvCloudflareIgnored, gitSafetyWarnings, inspectGitSafety } from "./git-safety.js";
import {
  ACCOUNT_SETUP_VERSION,
  BOOTSTRAP,
  comparePolicies,
  deepLink,
  EVERYDAY,
  inPlaceUpdateBody,
  PERMISSIONS_VERSION,
  probeEveryday,
  TOKEN_NAMES,
  type PermissionGroup,
  type TokenDetails,
  type TokenKind,
  type TokenPolicy,
} from "./permissions.js";
import { workersPlanReader } from "./plan.js";
import { frameworkVersion as packageVersion } from "./setup-record.js";
import { applySetupSteps, checkAccountSetup, SETUP_STEPS, type SetupStepOptions } from "./setup-steps.js";
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
  /** Resolves when an HTTPS request to `url` got any answer; rejects when the host cannot be reached. */
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
  /** `--email-domain`: the answer to step 5's question. */
  readonly emailDomain?: string;
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

const KIND: Readonly<Record<Slot, TokenKind>> = { [BOOTSTRAP_SETTING]: "bootstrap", [EVERYDAY_SETTING]: "everyday" };
const TITLE: Readonly<Record<Slot, string>> = {
  [BOOTSTRAP_SETTING]: `${BOOTSTRAP_SETTING} (the bootstrap token)`,
  [EVERYDAY_SETTING]: `${EVERYDAY_SETTING} (the everyday token)`,
};

/** What to choose on each link's page (plan §2, §3.2): the link cannot set the account, the zone or the expiry. */
const PAGE_CHOICES: Readonly<Record<TokenKind, string>> = {
  bootstrap:
    "On the page: pick your account if the dashboard asks; keep your email domain's zone included (the link covers all the account's zones); under TTL, set an end date 7 days away or sooner. Then choose Continue to summary, then Create Token, and copy the token.",
  everyday:
    "On the page: pick your account if the dashboard asks; keep your email domain's zone included (the link covers all the account's zones); no TTL (expiry) is needed. Then choose Continue to summary, then Create Token, and copy the token.",
};

/** One token's link with what to choose on its page. */
export function linkBlock(kind: TokenKind): string {
  const what = kind === "bootstrap" ? "The bootstrap token (used once by this setup, which then deletes it)" : "The everyday token (used by deploy and the other commands)";
  return `${what}, named ${TOKEN_NAMES[kind]}:\n  ${deepLink(kind)}\n  ${PAGE_CHOICES[kind]}\n`;
}

/** Where the values go (plan §3.2): the cloud session's environment settings, or the command line's file or environment. */
export const WHERE_IT_GOES = [
  "Where the values go:",
  "  - In a Claude Code cloud session: open the environment menu, choose Edit, and add each NAME=value line under Environment variables; save, then start a new session.",
  `  - On the command line: in the file ${ENV_CLOUDFLARE_FILE} in the project folder (which holds the template), or in the environment.`,
].join("\n") + "\n";

/** Plan §3.2's requirements. */
export const REQUIREMENTS = [
  "Requirements:",
  "  - a Cloudflare account on the Workers Paid plan: sign-in by email (Better Auth with Cloudflare Email Sending) needs it;",
  "  - a domain on Cloudflare DNS in that account, which the sign-in emails are sent from.",
].join("\n") + "\n";

/** The whole no-token output (plan §3.2, §4.3 step 3). */
export function noTokensText(): string {
  return [
    "Cloudflare setup needs two API tokens, both made from pre-filled dashboard links. Setup never prints a token.\n",
    REQUIREMENTS,
    `1. ${linkBlock("bootstrap")}`,
    `2. ${linkBlock("everyday")}`,
    `Fill in this template (leave CLOUDFLARE_EMAIL_DOMAIN empty to choose from your domains next time):\n${ENV_CLOUDFLARE_TEMPLATE}`,
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

/**
 * The token write guard (DEC-0589, DEC-0613): every request through `api` other than a GET that
 * names an API token's ID is checked before it is sent. The path judged is the one sent
 * (`sentPath`: `API_BASE + path` as the URL parser normalises it, each segment decoded), and IDs
 * and the path's names are compared in any case. Refused: any such request on a protected ID; any
 * method but PUT and DELETE, and any sub-path (the value roll); a DELETE of the everyday token; a
 * DELETE of the bootstrap token outside its self-delete; a PUT of anything but the everyday token;
 * a request whose URL cannot be parsed. Creating a token (`POST …/tokens`, the signing step) names
 * no ID.
 */
export function guardTokenWrites(
  api: CloudflareApi,
  rules: { readonly protectedIds: ReadonlySet<string>; readonly everydayId?: string; readonly bootstrapId?: string; readonly selfDeleteArmed: () => boolean },
): CloudflareApi {
  const protectedIds = new Set([...rules.protectedIds].map((id) => id.toLowerCase()));
  const everydayId = rules.everydayId?.toLowerCase();
  const bootstrapId = rules.bootstrapId?.toLowerCase();
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
        if ((method !== "PUT" && method !== "DELETE") || m?.[2] !== undefined) refuse("setup only deletes the bootstrap token and updates the everyday token's permissions");
        if (method === "DELETE" && id === everydayId) refuse("it is the everyday token");
        if (method === "DELETE" && id === bootstrapId && !rules.selfDeleteArmed()) refuse("the bootstrap token is deleted only by its own last step");
        if (method === "PUT" && (id !== everydayId || id === bootstrapId)) refuse("only the everyday token is updated in place");
      }
    }
    return api(method, path, body);
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

interface Zone {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
}

async function listZones(api: CloudflareApi, accountId: string, name?: string): Promise<Zone[] | ApiReply> {
  const r = await api("GET", `/zones?${name === undefined ? "" : `name=${encodeURIComponent(name)}&`}account.id=${accountId}&per_page=50`);
  const list = resultOf<unknown[]>(r);
  if (!Array.isArray(list)) return r;
  return list.flatMap((z) => {
    const { id, name: n, status } = (z ?? {}) as { id?: unknown; name?: unknown; status?: unknown };
    return typeof id === "string" && typeof n === "string" ? [{ id, name: n, ...(typeof status === "string" ? { status } : {}) }] : [];
  });
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
    // The tokens and the account ID are never printed; the email domain is.
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

    // 3. No everyday token (only a bootstrap token): its link, the template and where it goes.
    if (everydayValue === undefined) {
      const lines = [`${EVERYDAY_SETTING} is not set. Setup needs the everyday token too.\n`, linkBlock("everyday")];
      for (const p of problems) lines.push(problemText(p.slot, p.text));
      if (unusableBootstrap !== undefined) lines.push(problemText(BOOTSTRAP_SETTING, unusableBootstrap));
      lines.push(`Fill in this template:\n${ENV_CLOUDFLARE_TEMPLATE}`, WHERE_IT_GOES, NEXT_PROMPT);
      return stop(lines.join("\n"));
    }
    if (problems.length > 0 || everyday === undefined) return stop([...problems.map((p) => problemText(p.slot, p.text)), NEXT_PROMPT].join("\n"));

    let selfDeleteArmed = false;
    const guard = (api: CloudflareApi) => guardTokenWrites(api, { protectedIds, everydayId: everyday.id, ...(boot === undefined ? {} : { bootstrapId: boot.id }), selfDeleteArmed: () => selfDeleteArmed });
    const everydayApi = guard(everyday.api);
    const bootApi = boot === undefined ? undefined : guard(boot.api);

    // 4. The account: the everyday token's, checked against CLOUDFLARE_ACCOUNT_ID (DEC-0585).
    const candidates = everyday.accounts;
    let account: Account | undefined;
    let switched = false;
    if (configuredAccount !== undefined) {
      account = candidates.find((a) => a.id === configuredAccount);
      if (account === undefined) {
        if (candidates.length > 1) return stop(chooseAccountText(candidates, true));
        account = candidates[0];
        if (account === undefined) return stop(problemText(EVERYDAY_SETTING, "it can see no Cloudflare account"));
        if (request.switchAccount !== true) return stop(accountSwitchText(account));
        switched = true;
        say(`switching this project to the account "${account.name}" (--switch-account)`);
      }
    } else if (candidates.length === 1) {
      account = candidates[0];
    } else {
      return stop(chooseAccountText(candidates, false));
    }
    if (account === undefined) return stop(problemText(EVERYDAY_SETTING, "it can see no Cloudflare account"));
    const accountId = account.id;
    hidden.add(accountId);
    if (boot !== undefined && !boot.accounts.some((a) => a.id === accountId)) {
      const theirs = boot.owner?.name ?? "another account";
      return stop([problemText(BOOTSTRAP_SETTING, `it belongs to the account "${theirs}", not "${account.name}", which ${EVERYDAY_SETTING} uses; make it on that account`), NEXT_PROMPT].join("\n"));
    }
    say(`account: ${account.name}`);

    // 4 (cont.). The plan, before the email domain is asked for: read with Billing Read (the bootstrap token's); a refused read is not checked.
    const plan = await workersPlanReader(bootApi ?? everydayApi, accountId, deps.env)();
    if (plan.plan === "free") {
      return stop(
        `The account "${account.name}" is on the Workers Free plan. Sign-in by email (Better Auth with Cloudflare Email Sending) needs Workers Paid: upgrade it in the dashboard (Workers & Pages, Plans), then run setup again.\n${NEXT_PROMPT}`,
      );
    }
    const planText = plan.plan === "paid" ? "Workers Paid" : 'not checked (reading it needs "Billing Read", which only the bootstrap token has)';

    // 5. The email domain.
    const zoneApi = bootApi ?? everydayApi;
    const given = request.emailDomain?.trim().toLowerCase();
    const fromSettings = settings.values.CLOUDFLARE_EMAIL_DOMAIN?.trim().toLowerCase();
    if (given !== undefined && fromSettings !== undefined && given !== fromSettings) warn(`note: using --email-domain ${given} instead of CLOUDFLARE_EMAIL_DOMAIN (${fromSettings})`);
    const domain = given ?? fromSettings;
    if (domain === undefined) {
      const zones = await listZones(zoneApi, accountId);
      if (!Array.isArray(zones)) return stop([problemText(EVERYDAY_SETTING, `it could not list the account's domains (${describeFailure(zones)}); it needs "Zone Read"`), NEXT_PROMPT].join("\n"));
      for (const z of zones) hidden.add(z.id);
      return stop(chooseDomainText(account, zones));
    }
    const domainProblem = emailDomainProblem(domain);
    if (domainProblem !== undefined) return stop(`The email domain ${domainProblem}. Set CLOUDFLARE_EMAIL_DOMAIN to a domain name such as example.com, or run: npm run cloudflare-setup -- --email-domain <domain>`);
    let zone: Zone | undefined;
    for (const name of zoneCandidates(domain)) {
      const found = await listZones(zoneApi, accountId, name);
      if (!Array.isArray(found)) {
        return stop([`Looking up the zone of ${domain} failed (${describeFailure(found)}).`, problemText(boot === undefined ? EVERYDAY_SETTING : BOOTSTRAP_SETTING, 'it needs "Zone Read" on the email domain\'s zone'), NEXT_PROMPT].join("\n"));
      }
      zone = found.find((z) => z.name === name);
      if (zone !== undefined) break;
    }
    if (zone === undefined) {
      const zones = await listZones(zoneApi, accountId);
      return stop(`The email domain ${domain} is not a domain of the account "${account.name}" on Cloudflare DNS.\n${Array.isArray(zones) ? chooseDomainText(account, zones) : NEXT_PROMPT}`);
    }
    hidden.add(zone.id);
    if (zone.status !== undefined && zone.status !== "active") return stop(`The zone ${zone.name} is ${zone.status}, not active: finish adding it to Cloudflare DNS in the dashboard, then run setup again.\n${NEXT_PROMPT}`);
    say(`email domain: ${domain}`);
    const scope = { accountId, zoneId: zone.id };

    // 2 (cont.). The everyday token's quick check, now that the zone is known.
    const probe = await probeEveryday(everydayApi, scope);
    const failedProbe = probe.filter((r) => !r.ok);
    const probeText = failedProbe.map((r) => `"${r.group.name}" (HTTP ${String(r.status)})`).join(", ");

    let changed = false;
    let everydayState = `passed the quick check (one read per permission of list version ${String(PERMISSIONS_VERSION)})`;
    let setupState: string;
    if (boot === undefined || bootApi === undefined) {
      // 6. The setup record, with the everyday token.
      let reasons: string[];
      try {
        const status = await checkAccountSetup(everydayApi, accountId, domain, ACCOUNT_SETUP_VERSION, deps.stepOptions ?? {});
        reasons = [];
        if (status.record === undefined) reasons.push("the account has not been set up by this setup yet");
        else if (status.record.setupVersion < ACCOUNT_SETUP_VERSION) reasons.push(`the account's setup is at version ${String(status.record.setupVersion)}, and this release needs version ${String(ACCOUNT_SETUP_VERSION)}`);
        else if (status.record.emailDomain !== domain) reasons.push(`the account was set up for another email domain (${status.record.emailDomain})`);
        if (status.missing.length > 0) reasons.push(`these setup steps are missing: ${status.missing.join(", ")}`);
        if (reasons.length === 0 && !status.current) reasons.push("the account's setup is not current");
      } catch (error) {
        reasons = [`the account's setup could not be read with ${EVERYDAY_SETTING} (${messageOf(error)})`];
      }
      if (failedProbe.length > 0) reasons.push(`${EVERYDAY_SETTING} failed the quick check for ${probeText}; the bootstrap token adds missing permissions to it in place (its value stays the same)`);
      if (reasons.length > 0) {
        return stop(
          [
            `This needs the bootstrap token once:\n${reasons.map((r) => `  - ${r}`).join("\n")}\n`,
            unusableBootstrap === undefined ? linkBlock("bootstrap") : problemText(BOOTSTRAP_SETTING, unusableBootstrap),
            `Put it in ${BOOTSTRAP_SETTING}.`,
            WHERE_IT_GOES,
            NEXT_PROMPT,
          ].join("\n"),
        );
      }
      setupState = `current (setup version ${String(ACCOUNT_SETUP_VERSION)})`;
      if (unusableBootstrap !== undefined) {
        const where = settings.sources.CLOUDFLARE_BOOTSTRAP_TOKEN === "file" ? ENV_CLOUDFLARE_FILE : cloudSession ? "the cloud environment's settings (environment menu, Edit, Environment variables)" : "the environment";
        warn(`note: ${BOOTSTRAP_SETTING} is no longer a valid token (setup deletes it when it is done). Nothing needs it now: remove it from ${where}.`);
      }
    } else {
      // 7. With the bootstrap token: its own permissions first.
      const own = await bootApi("GET", `/accounts/${accountId}/tokens/${boot.id}`);
      const ownDetails = resultOf<TokenDetails>(own);
      if (ownDetails === undefined || !Array.isArray(ownDetails.policies)) {
        return stop([problemText(BOOTSTRAP_SETTING, `it cannot read API tokens (${describeFailure(own)}), so it lacks "Account API Tokens Write": was the everyday token pasted there?`), NEXT_PROMPT].join("\n"));
      }
      const own_ = comparePolicies(ownDetails.policies, BOOTSTRAP, scope);
      if (own_.missing.length > 0) return stop([problemText(BOOTSTRAP_SETTING, `it lacks ${groupNames(own_.missing)} on this account or the email domain's zone`), NEXT_PROMPT].join("\n"));
      if (boot.expiresOn === undefined) {
        warn(`WARNING: ${BOOTSTRAP_SETTING} has no expiry. Setup deletes it at the end of a successful run; if setup stops before that, delete it yourself in the dashboard (Manage account, Account API tokens, ${TOKEN_NAMES.bootstrap}), or make it with a TTL of 7 days or less next time.`);
      }

      // The missing setup steps, then the record (applySetupSteps writes it last).
      const { applied } = await applySetupSteps(bootApi, accountId, {
        emailDomain: domain,
        steps: SETUP_STEPS,
        setupVersion: ACCOUNT_SETUP_VERSION,
        frameworkVersion: deps.frameworkVersion ?? packageVersion(),
        now: deps.now ?? (() => new Date()),
        ...deps.stepOptions,
        note: (message) => say(`note: ${message}`),
      });
      if (applied.length > 0) {
        changed = true;
        say(`account setup: applied ${applied.join(", ")}`);
      } else say("account setup: every step was already done");
      setupState = `current (setup version ${String(ACCOUNT_SETUP_VERSION)})`;

      // The everyday token, checked exactly once with the bootstrap token.
      const check = await checkEverydayOnce();
      if ("remake" in check) {
        return stop([problemText(EVERYDAY_SETTING, check.remake), `The bootstrap token was kept, so the next run checks the new everyday token.`, NEXT_PROMPT].join("\n"));
      }
      everydayState = check.state;
      if (check.updated === true) changed = true;

      // The bootstrap token deletes itself: its own ID, from its own verify call, never another.
      selfDeleteArmed = true;
      const deleted = await bootApi("DELETE", `/accounts/${accountId}/tokens/${boot.id}`);
      selfDeleteArmed = false;
      if (!succeeded(deleted)) {
        return stop(
          `The bootstrap token could not delete itself (${describeFailure(deleted)}). Delete it in the dashboard (Manage account, Account API tokens, ${TOKEN_NAMES.bootstrap}), then remove ${BOOTSTRAP_SETTING}.`,
        );
      }
      changed = true;
      say("the bootstrap token deleted itself");
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

    // 9 (record). CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_DOMAIN filled in, so copying the file starts the next project.
    if (switched && settings.sources.CLOUDFLARE_ACCOUNT_ID === "environment") {
      say(`Change CLOUDFLARE_ACCOUNT_ID in the environment to the account "${account.name}"'s ID (environment settings in a cloud session); it still names the old account.`);
    }
    try {
      const filled = fillInSettings(dir, { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_EMAIL_DOMAIN: domain }, switched && settings.sources.CLOUDFLARE_ACCOUNT_ID === "file" ? { replace: ["CLOUDFLARE_ACCOUNT_ID"] } : {});
      if (filled.length > 0) {
        changed = true;
        say(`recorded ${filled.join(" and ")} in ${ENV_CLOUDFLARE_FILE}`);
      }
    } catch (error) {
      warn(`could not record the account and email domain in ${ENV_CLOUDFLARE_FILE} (${messageOf(error)})`);
    }

    // 8. Network.
    const blocked = await networkProblems(accountId, everydayApi);

    // 9. Summary.
    say();
    say(changed ? "Cloudflare setup is complete." : "Everything is already set up and current: nothing to do.");
    say(`  account: ${account.name}`);
    say(`  email domain: ${domain}`);
    say(`  account setup: ${setupState}`);
    say(`  everyday token: ${everydayState}`);
    say(`  plan: ${planText}`);
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

    /** Step 7's single check of the everyday token, with the bootstrap token. */
    async function checkEverydayOnce(): Promise<{ readonly state: string; readonly updated?: boolean } | { readonly remake: string }> {
      if (everyday === undefined || bootApi === undefined || zone === undefined) throw new Error("internal: the everyday check needs both tokens and the zone");
      const r = everyday.user ? undefined : await bootApi("GET", `/accounts/${accountId}/tokens/${everyday.id}`);
      const details = r === undefined ? undefined : resultOf<TokenDetails>(r);
      if (details === undefined || !Array.isArray(details.policies)) {
        // A user token, or one of another account: its permissions cannot be read here (DEC-0586).
        if (failedProbe.length === 0) return { state: "passed the quick check; it is not an account API token of this account, so its permissions were not read" };
        return { remake: `it failed the quick check for ${probeText}, and it is not an account API token of this account, so setup cannot add them; make the everyday token from its link` };
      }
      const policies: readonly TokenPolicy[] = details.policies;
      const c = comparePolicies(policies, EVERYDAY, scope);
      if (c.wrongAccount) return { remake: "it is scoped to another account; make it again from its link, on this account" };
      const zoneGroups = EVERYDAY.filter((g) => g.scope === "zone");
      // Zone groups granted somewhere, but not on the email domain's zone: scoped to the wrong zone.
      const someZoneGrant = policies.some((p) => p.effect === "allow" && zoneGroups.some((g) => p.permission_groups.some((h) => h.id === g.id || h.name === g.name)));
      if (!c.zoneCovered && someZoneGrant) return { remake: `it is scoped to other zones, not the email domain's zone (${zone.name}); make it again from its link, keeping that zone included` };
      if (c.denied.length > 0) return { remake: `a deny policy takes away ${groupNames(c.denied)}, which an update cannot override; make it again from its link` };
      if (c.missing.length === 0) return { state: `has every permission of list version ${String(PERMISSIONS_VERSION)}` };
      if (protectedIds.has(everyday.id)) return { remake: `it lacks ${groupNames(c.missing)}, and its ID is protected, so setup did not change it` };
      const put = await bootApi("PUT", `/accounts/${accountId}/tokens/${everyday.id}`, inPlaceUpdateBody(details, c.missing, scope));
      if (!succeeded(put)) throw new Error(`adding ${groupNames(c.missing)} to ${EVERYDAY_SETTING} failed (${describeFailure(put)}); the bootstrap token was kept, so run setup again`);
      say(`added ${groupNames(c.missing)} to ${EVERYDAY_SETTING} in place (its value is unchanged)`);
      return { state: `updated in place to list version ${String(PERMISSIONS_VERSION)}`, updated: true };
    }
  }

  /** Step 8: each host by its kind, never the account ID or the subdomain (DEC-0590). */
  async function networkProblems(accountId: string, api: CloudflareApi): Promise<string[]> {
    const hosts: { what: string; url: string }[] = [
      { what: "the Cloudflare API (api.cloudflare.com)", url: "https://api.cloudflare.com/client/v4/" },
      { what: "the account's R2 storage host (<account ID>.r2.cloudflarestorage.com)", url: `https://${accountId}.r2.cloudflarestorage.com/` },
    ];
    try {
      const subdomain = await accountSubdomain(api, accountId);
      hidden.add(subdomain);
      hosts.push({ what: "the account's workers.dev subdomain (<subdomain>.workers.dev)", url: `https://${subdomain}.workers.dev/` });
    } catch {
      hosts.push({ what: "the account's workers.dev subdomain (it could not be read)", url: "" });
    }
    const blocked: string[] = [];
    for (const h of hosts) {
      try {
        if (h.url === "") throw new Error("unknown");
        await deps.reach(h.url);
      } catch {
        blocked.push(h.what);
      }
    }
    return blocked;
  }
}

/** One token's problem (bad paste, plan §3.4): which token, what is wrong, and only that token's link. */
function problemText(slot: Slot, text: string): string {
  return `${TITLE[slot]}: ${text}.\nReplace it with a new token from this link:\n  ${deepLink(KIND[slot])}\n  ${PAGE_CHOICES[KIND[slot]]}\n`;
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

/** The email domain question (step 5): the account's zone names. */
function chooseDomainText(account: Account, zones: readonly Zone[]): string {
  if (zones.length === 0) {
    return `The account "${account.name}" has no domain on Cloudflare DNS. The sign-in emails need one: add a domain in the dashboard (https://dash.cloudflare.com, Add a domain), wait until it is active, then run setup again.\n${NEXT_PROMPT}`;
  }
  return [
    `Which domain should the sign-in emails come from? The account "${account.name}" has these domains on Cloudflare DNS:`,
    ...zones.map((z, i) => `  ${String(i + 1)}. ${z.name}${z.status !== undefined && z.status !== "active" ? ` (${z.status})` : ""}`),
    `Set CLOUDFLARE_EMAIL_DOMAIN to one of them in ${ENV_CLOUDFLARE_FILE} (or in the environment), or run: npm run cloudflare-setup -- --email-domain <domain>`,
    NEXT_PROMPT,
  ].join("\n");
}
