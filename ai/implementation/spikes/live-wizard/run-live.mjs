// `NODE_USE_ENV_PROXY=1 node ai/implementation/spikes/live-wizard/run-live.mjs <live-pass.ts | cleanup.ts>`: one
// step of the live wizard pass, bundled by the compliance harness's launcher (as run-preflight.mjs).
// A failure prints only its message, with the token, the account ID, any 32-hex ID and any
// workers.dev subdomain removed.
import { launch } from "../../../../tests/compliance/harness/launch.mjs";

const entry = process.argv[2];
if (!["live-pass.ts", "recheck.ts", "network-probe.ts", "d1-usage.ts", "cleanup.ts"].includes(entry)) throw new Error("usage: run-live.mjs live-pass.ts|recheck.ts|network-probe.ts|d1-usage.ts|cleanup.ts");
try {
  await launch(`ai/implementation/spikes/live-wizard/${entry}`);
} catch (error) {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  for (const [value, replacement] of [
    [process.env.CLOUDFLARE_API_TOKEN, "<CLOUDFLARE_API_TOKEN>"],
    [process.env.CLOUDFLARE_ACCOUNT_ID, "<account-id>"],
  ]) {
    if (value) text = text.split(value).join(replacement);
  }
  text = text.replace(/\b[0-9a-f]{32}\b/gi, "<id>").replace(/\b([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev\b/gi, "$1.<subdomain>.workers.dev");
  process.stderr.write(`${entry} failed: ${text}\n`);
  process.exitCode = 1;
}
