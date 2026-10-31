/**
 * The admin app's Worker: a stub for now (item C, v0.2.0 plan §5.1 step 3). It answers every
 * request with a placeholder sign-in page. Item E replaces it with the real admin app (sign-in
 * through the admin client, the account-setup, everyday-token and status pages of plan §5.2).
 *
 * The bootstrap uploads `ADMIN_APP_SOURCE` (`provision/cloudflare/admin-app-deploy.ts`): the same
 * Worker as one self-contained ES module, so nothing has to be bundled or read from disk. A unit
 * test checks that the two answer alike. The Worker is bound to the admin client's ID and secret
 * in Secrets Store (`ADMIN_CLIENT_ID`, `ADMIN_CLIENT_SECRET`); the stub does not read them.
 */

/** The placeholder page. */
export const ADMIN_APP_PAGE = [
  "<!doctype html>",
  '<html lang="en">',
  '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prototype admin</title></head>',
  "<body>",
  "<h1>Prototype admin</h1>",
  "<p>Sign in with Cloudflare: the admin app is deployed, but its sign-in is not ready yet in this framework version.</p>",
  "</body>",
  "</html>",
  "",
].join("\n");

const HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

/** The Worker module the bootstrap uploads: `ADMIN_APP_PAGE` for every request. */
export const ADMIN_APP_SOURCE = `const PAGE = ${JSON.stringify(ADMIN_APP_PAGE)};
const HEADERS = ${JSON.stringify(HEADERS)};
export default {
  async fetch() {
    return new Response(PAGE, { status: 200, headers: HEADERS });
  },
};
`;

export default {
  fetch(): Promise<Response> {
    return Promise.resolve(new Response(ADMIN_APP_PAGE, { status: 200, headers: HEADERS }));
  },
};
