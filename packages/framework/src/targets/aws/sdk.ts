/**
 * The request handler every AWS SDK v3 client of the framework gets, runtime and CLI alike
 * (DEC-PENDING-g-s1-5, DEC-PENDING-G-07-5): `new https.Agent({ keepAlive: true, proxyEnv })`,
 * given as the handler's options object so the SDK builds `NodeHttpHandler.create(options)`
 * itself (no direct `@smithy/node-http-handler` dependency). It honours `HTTPS_PROXY` and
 * `NO_PROXY` from `env` and connects directly when none is set, as in Lambda. Shared by
 * provisioning (`provision/aws/environment.ts`) and the Lambda runtime; it imports no client.
 */
import https from "node:https";

export type Environment = Readonly<Record<string, string | undefined>>;

/** `https.Agent` options of Node 22.22 that @types/node 22.20.5 does not declare yet (G-S1 §5). */
type ProxyAgentOptions = https.AgentOptions & { readonly proxyEnv?: Environment };

/** The proxy-aware request handler options for an SDK client. */
export function proxyAwareHandler(env: Environment): { readonly httpsAgent: https.Agent } {
  const options: ProxyAgentOptions = { keepAlive: true, proxyEnv: env };
  return { httpsAgent: new https.Agent(options) };
}
