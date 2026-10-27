// `NODE_USE_ENV_PROXY=1 node ai/implementation/spikes/live-wizard/run-preflight.mjs`: the live
// wizard pass's read-only preflight (preflight.ts), bundled by the compliance harness's launcher.
// A failure prints only its message, with the token, the account ID, any 32-hex ID and any
// workers.dev subdomain removed (a request path names the account).
import { launch } from "../../../../tests/compliance/harness/launch.mjs";

try {
  await launch("ai/implementation/spikes/live-wizard/preflight.ts");
} catch (error) {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  for (const [value, replacement] of [
    [process.env.CLOUDFLARE_API_TOKEN, "<CLOUDFLARE_API_TOKEN>"],
    [process.env.CLOUDFLARE_ACCOUNT_ID, "<account-id>"],
  ]) {
    if (value) text = text.split(value).join(replacement);
  }
  text = text.replace(/\b[0-9a-f]{32}\b/gi, "<id>").replace(/\b([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev\b/gi, "$1.<subdomain>.workers.dev");
  process.stderr.write(`preflight failed: ${text}\n`);
  process.exitCode = 1;
}
