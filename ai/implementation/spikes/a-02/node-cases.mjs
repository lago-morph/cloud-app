// Usage: node node-cases.mjs <url>
// Runs fetch.mjs under several environments and prints each result.
import { spawnSync } from "node:child_process";

const url = process.argv[2];
const base = { PATH: process.env.PATH, HOME: process.env.HOME, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY ?? "" };
const full = { ...process.env };
delete full.NODE_USE_ENV_PROXY;
const cases = [
  ["A: sandbox env + NODE_USE_ENV_PROXY=1", { ...full, NODE_USE_ENV_PROXY: "1" }],
  ["B: sandbox env, NODE_USE_ENV_PROXY unset", full],
  ["C: minimal env (PATH HOME HTTPS_PROXY NO_PROXY) + NODE_USE_ENV_PROXY=1, no NODE_EXTRA_CA_CERTS", { ...base, NODE_USE_ENV_PROXY: "1" }],
  ["D: as C + NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt", { ...base, NODE_USE_ENV_PROXY: "1", NODE_EXTRA_CA_CERTS: "/root/.ccr/ca-bundle.crt" }],
];
console.log(`sandbox NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS ?? "unset"} SSL_CERT_FILE=${process.env.SSL_CERT_FILE ?? "unset"}`);
for (const [name, env] of cases) {
  const r = spawnSync(process.execPath, [new URL("./fetch.mjs", import.meta.url).pathname, url], { env, encoding: "utf8", timeout: 60_000 });
  console.log(`## ${name}\n${r.stdout}${r.stderr}exit=${r.status}`);
}
