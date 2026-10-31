/**
 * The admin app's Worker entry (v0.2.0 plan §3, §5.2; D3, D10). It replaces C's stub: sign-in
 * through the admin client and the admin pages (app.ts, pages.ts). Settings: config.ts
 * (DEC-0711). Logs are one JSON line each on the console; never a code, state, token or secret.
 *
 * The bootstrap uploads it as one ES module that `bundle.ts` builds from this file
 * (admin-app-deploy.ts; DEC-0712). Nothing here may import Node built-ins.
 */
import { handleAdminRequest } from "./app.js";
import { readAdminConfig } from "./config.js";
import { logLine } from "./grant.js";
import { page } from "./html.js";
import { ADMIN_PAGES } from "./pages.js";

const log = (line: string): void => console.log(line);

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    let config;
    try {
      config = await readAdminConfig(env);
    } catch (e) {
      log(logLine("error", e instanceof Error ? e.message : "admin app misconfigured"));
      return page("Prototype admin", "<p>The admin app is not set up correctly. Run <code>npm run cloudflare-setup</code> again with a bootstrap token.</p>", { status: 500 });
    }
    return handleAdminRequest(request, { fetch: (input, init) => fetch(input, init), now: Date.now, log, config, pages: ADMIN_PAGES });
  },
};
