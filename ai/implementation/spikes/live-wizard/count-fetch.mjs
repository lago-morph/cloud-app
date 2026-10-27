// Preloaded (`--import`) into the framework CLI processes of the live pass's exercises 6 and 7
// (`run-cli.mjs`): counts every request Node's global fetch sends to a Cloudflare host (one line
// per request in LIVE_COUNT_FILE: method and host kind, never a path, ID or value), refuses any
// write on an API tokens path (those runs use the everyday token alone and must send none), and
// records a 429. Requests from non-Node programs the CLI starts (SST's and Pulumi's binaries) are
// not seen, so the count is a lower bound for deploy and remove.
import { appendFileSync } from "node:fs";

const file = process.env.LIVE_COUNT_FILE;
const original = globalThis.fetch;
const kindOf = (host) =>
  host === "api.cloudflare.com" ? "api" : host.endsWith(".r2.cloudflarestorage.com") ? "r2" : host.endsWith(".workers.dev") ? "workers.dev" : host.endsWith(".cloudflare.com") ? "other-cloudflare" : undefined;

if (file && typeof original === "function") {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const kind = kindOf(url.hostname);
    if (kind === undefined) return original(input, init);
    if (kind === "api" && method !== "GET" && /\/(?:accounts\/[^/]+|user)\/tokens(?:\/|$)/i.test(url.pathname)) {
      appendFileSync(file, `REFUSED ${method} tokens\n`);
      throw new Error("live pass (count-fetch): a write on an API tokens path was refused");
    }
    appendFileSync(file, `${method} ${kind}\n`);
    const reply = await original(input, init);
    if (reply.status === 429) appendFileSync(file, `429 ${kind}\n`);
    return reply;
  };
}
