/**
 * One test client, one connection (root cause
 * ai/implementation/root-causes/2026-10-25-pwd-ac-008-burst-split-over-egress-ips.md).
 *
 * Node's `fetch` (undici) spreads even strictly sequential requests to one origin over two
 * sockets. Behind an egress proxy that leaves from a pool of addresses (the cloud sandbox's), each
 * socket can have its own public IP, so Cloudflare's `CF-Connecting-IP` names one test client as
 * several, and a per-IP limit (PWD-REQ-006) is never reached by a burst from "one client".
 *
 * `oneConnectionDispatcher()` is a dispatcher with one connection per origin, through the
 * environment's proxy when one is set (as `NODE_USE_ENV_PROXY=1` does for the built-in one,
 * DEC-0085). It is passed per request (`dispatcher` in the fetch options), not installed
 * globally: Wrangler, which the framework's testing entry imports, replaces the global
 * dispatcher with its own when proxy variables are set.
 */
import { Agent, EnvHttpProxyAgent, type Dispatcher } from "undici";

function proxySet(env: NodeJS.ProcessEnv): boolean {
  return [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy].some((v) => v !== undefined && v !== "");
}

export function oneConnectionDispatcher(env: NodeJS.ProcessEnv = process.env): Dispatcher {
  return proxySet(env) ? new EnvHttpProxyAgent({ connections: 1 }) : new Agent({ connections: 1 });
}

/** `init` with `dispatcher` added (Node's `fetch` option; not part of the DOM `RequestInit` type). */
export function withDispatcher(init: RequestInit, dispatcher: Dispatcher): RequestInit {
  return { ...init, dispatcher } as RequestInit;
}

/** A `fetch` whose every request goes over `dispatcher`. */
export function fetchOver(dispatcher: Dispatcher): typeof fetch {
  return (input, init) => fetch(input, withDispatcher(init ?? {}, dispatcher));
}
