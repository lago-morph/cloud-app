// Where the live-pass runner keeps the test Cloudflare account's ID and its tokens (DEC-0793).
//
// One directory outside the repository (default ~/.live-pass-secrets, mode 700), one file per value
// (mode 600), named after the value. The session agent writes the owner's pasted values there with
// its file-writing tool; the runner writes the values it makes itself (the rolled everyday token).
// Nothing is read from the process environment: this sandbox's own CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID belong to the primary Cloudflare account and never reach a command.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SECRETS_DIR = join(homedir(), ".live-pass-secrets");

/** The values the runner knows, by file name. */
export const SECRET = {
  account: "CLOUDFLARE_ACCOUNT_ID", // the test Cloudflare account's ID (not a secret, kept with the token)
  owner: "LIVE_PASS_OWNER_TOKEN", // the owner's one token, live-pass-owner
  starter: "LIVE_PASS_STARTER", // the starter token for S4 (pasted by the owner)
  starterRerun: "LIVE_PASS_STARTER_RERUN", // the second starter token, S5
  everyday: "CLOUDFLARE_API_TOKEN", // the everyday token's value, rolled by the runner (or pasted)
};

/** Every name that holds a token (all but the account ID). */
export const TOKEN_NAMES = Object.values(SECRET).filter((n) => n !== SECRET.account);

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The directory's values: { values, loose }. `loose` names files (or the directory) that others can read. */
export function loadSecrets(dir) {
  const values = {};
  const loose = [];
  if (!existsSync(dir)) return { values, loose };
  if ((statSync(dir).mode & 0o077) !== 0) loose.push(dir);
  for (const name of readdirSync(dir)) {
    if (!NAME.test(name)) continue;
    const file = join(dir, name);
    const st = statSync(file);
    if (!st.isFile()) continue;
    if ((st.mode & 0o077) !== 0) loose.push(file);
    const value = readFileSync(file, "utf8").trim();
    if (value !== "") values[name] = value;
  }
  return { values, loose };
}

/** Writes one value (mode 600, in a mode-700 directory) without printing it. */
export function saveSecret(dir, name, value) {
  if (!NAME.test(name)) throw new Error(`${JSON.stringify(name)} is not a secret name`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, name);
  writeFileSync(file, `${value}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/**
 * What stops the runner: a missing account ID or owner token, a loose file, the primary Cloudflare
 * account's ID given as the test Cloudflare account's, or two names holding the same token.
 * @param {{ values: Record<string,string>, loose: string[] }} loaded
 * @param {{ primaryAccountId?: string, dir: string }} o
 */
export function secretsProblems({ values, loose }, { primaryAccountId, dir }) {
  const stop = [];
  const acc = values[SECRET.account];
  if (!acc) stop.push(`${dir}/${SECRET.account} is missing: save the test Cloudflare account's ID there`);
  else if (!/^[0-9a-f]{32}$/.test(acc)) stop.push(`${dir}/${SECRET.account} does not hold an account ID (32 hexadecimal characters)`);
  else if (primaryAccountId && acc === primaryAccountId.trim()) stop.push(`${dir}/${SECRET.account} holds the primary Cloudflare account's ID (this sandbox's own CLOUDFLARE_ACCOUNT_ID). The live pass runs only in the test Cloudflare account: save the test Cloudflare account's ID`);
  if (!values[SECRET.owner]) stop.push(`${dir}/${SECRET.owner} is missing: save the token live-pass-owner there`);
  for (const f of loose) stop.push(`${f} can be read by other users: run chmod 700 ${dir} and chmod 600 on each file in it`);
  const tokens = TOKEN_NAMES.filter((n) => values[n]).map((n) => [n, values[n]]);
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) if (tokens[i][1] === tokens[j][1]) stop.push(`${tokens[i][0]} and ${tokens[j][0]} hold the same token; each needs its own`);
  }
  return stop;
}
