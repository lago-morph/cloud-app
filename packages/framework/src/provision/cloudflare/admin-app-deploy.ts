/**
 * The admin app's deploy by the bootstrap (v0.2.0 plan §5.1 step 3; DEC-0686): the Worker
 * `prototype-admin` (PAR-438) uploaded through the script-upload API, bound to the admin client's
 * ID and secret in Secrets Store (`secrets_store_secret` bindings, which the upload API accepts,
 * plan §2.1b), with its `workers.dev` route turned on and previews off (DEC-0090). It needs only
 * Workers Scripts Write. Every run uploads the framework's current admin app, so a re-run with a
 * newer framework updates it. Returns the app's URL, which the bootstrap prints (plan §5.1 step 5).
 */
import { ADMIN_APP_SOURCE } from "../../admin-app/worker.js";
import { describeFailure, succeeded, type CloudflareApi } from "./api.js";
import { APP_SCRIPTS, appOrigin, CLIENT_SECRET_NAMES } from "./oauth-clients.js";

/** The module's part name in the upload. */
export const ADMIN_APP_MODULE = "worker.js";

/** The admin app Worker's compatibility date. */
export const ADMIN_APP_COMPATIBILITY_DATE = "2026-10-01";

/** PAR-439: the admin app's binding names of the admin client's ID and secret. */
export const ADMIN_APP_BINDINGS = Object.freeze({ clientId: "ADMIN_CLIENT_ID", clientSecret: "ADMIN_CLIENT_SECRET" });

const WHAT = `the admin app (Worker ${APP_SCRIPTS.admin})`;

/** Uploads and routes the admin app; its public URL. */
export async function deployAdminApp(api: CloudflareApi, accountId: string, options: { readonly storeId: string; readonly subdomain: string }): Promise<string> {
  const script = `/accounts/${accountId}/workers/scripts/${APP_SCRIPTS.admin}`;
  const binding = (name: string, secretName: string) => ({ type: "secrets_store_secret", name, store_id: options.storeId, secret_name: secretName });
  const metadata = {
    main_module: ADMIN_APP_MODULE,
    compatibility_date: ADMIN_APP_COMPATIBILITY_DATE,
    bindings: [binding(ADMIN_APP_BINDINGS.clientId, CLIENT_SECRET_NAMES.admin.id), binding(ADMIN_APP_BINDINGS.clientSecret, CLIENT_SECRET_NAMES.admin.secret)],
  };
  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  form.set(ADMIN_APP_MODULE, new Blob([ADMIN_APP_SOURCE], { type: "application/javascript+module" }), ADMIN_APP_MODULE);
  const uploaded = await api("PUT", script, form);
  if (!succeeded(uploaded)) throw new Error(`uploading ${WHAT} failed: ${describeFailure(uploaded)}`);
  const routed = await api("POST", `${script}/subdomain`, { enabled: true, previews_enabled: false });
  if (!succeeded(routed)) throw new Error(`turning on the workers.dev route of ${WHAT} failed: ${describeFailure(routed)}`);
  return appOrigin("admin", options.subdomain);
}
