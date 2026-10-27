// `node run-cli.mjs <app dir> <out dir> <label> <npm args…>`: one framework CLI run of the live
// pass's exercises 6 and 7, in a starter-made app, as a user runs it (`npm run …`), with:
// - no CLOUDFLARE_* variable in its environment (the tokens come from the app's .env.cloudflare);
// - NODE_USE_ENV_PROXY=1 and PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS set to the environment
//   token's ID (read from live-pass.ts's mode-600 secrets file, never printed);
// - count-fetch.mjs preloaded, counting its Cloudflare requests into <out>/<label>.count.
// Its output is redacted (every value of the secrets file, the account name, the email domain,
// any 32-hex ID and any <x>.<sub>.workers.dev host) before it is printed or saved to <out>/<label>.log.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [appDir, outDir, label, ...npmArgs] = process.argv.slice(2);
const secrets = JSON.parse(readFileSync(join(outDir, "secrets.json"), "utf8"));
const envFile = existsSync(join(appDir, ".env.cloudflare")) ? readFileSync(join(appDir, ".env.cloudflare"), "utf8") : "";
const domain = /^CLOUDFLARE_EMAIL_DOMAIN=(.+)$/m.exec(envFile)?.[1]?.trim();
const values = [...secrets.values, ...[...envFile.matchAll(/^\s*#?\s*[A-Z_]+=(.+)$/gm)].map((m) => m[1].trim())].filter((v) => v.length >= 6 && v !== domain).sort((a, b) => b.length - a.length);
const redact = (text) => {
  let out = text;
  for (const v of values) out = out.split(v).join("<secret>");
  out = out.replace(/[\w.+-]+@[\w.-]+'s Account/g, "<account name>");
  if (domain) out = out.split(domain).join("<email-domain>");
  return out.replace(/\b[0-9a-f]{32}\b/gi, "<id>").replace(/\b([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev\b/gi, "$1.<subdomain>.workers.dev");
};

const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith("CLOUDFLARE_")) delete env[k];
env.NODE_USE_ENV_PROXY = "1";
env.PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS = secrets.protectedIds.join(",");
const countFile = join(outDir, `${label}.count`);
writeFileSync(countFile, "");
env.LIVE_COUNT_FILE = countFile;
const preload = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "count-fetch.mjs")).href;
env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import ${preload}`.trim();

// LIVE_RANDOM_STDIN=1 (`secrets set`): a random value on standard input, redacted like the rest.
const stdinValue = process.env.LIVE_RANDOM_STDIN === "1" ? randomBytes(24).toString("hex") : undefined;
if (stdinValue !== undefined) values.unshift(stdinValue);
delete env.LIVE_RANDOM_STDIN;
const child = spawn("npm", ["run", ...npmArgs], { cwd: appDir, env, stdio: [stdinValue === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
if (stdinValue !== undefined) child.stdin.end(`${stdinValue}\n`);
let text = "";
child.stdout.on("data", (d) => (text += d));
child.stderr.on("data", (d) => (text += d));
const code = await new Promise((resolve) => child.on("close", resolve));
const counted = readFileSync(countFile, "utf8").split("\n").filter((l) => l !== "");
const summary = `exit ${String(code)}; Cloudflare requests seen by Node's fetch: ${String(counted.filter((l) => !l.startsWith("429") && !l.startsWith("REFUSED")).length)}; 429s: ${String(counted.filter((l) => l.startsWith("429")).length)}; refused: ${String(counted.filter((l) => l.startsWith("REFUSED")).length)}`;
const log = redact(`${text}\n--- ${summary}\n`);
writeFileSync(join(outDir, `${label}.log`), log);
process.stdout.write(log);
process.exitCode = code === 0 ? 0 : 1;
