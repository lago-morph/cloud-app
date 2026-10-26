/**
 * One client, one connection (PAR-330; password.md §2 "Real-provider check" step 7; DEC-0561).
 *
 * Node's `fetch` spreads even strictly sequential requests to one origin over several sockets.
 * Behind an egress proxy that leaves from a pool of addresses, each socket can have its own
 * public IP, so a burst from "one client" reaches a per-IP limit (PAR-258) as several clients.
 * `oneConnectionDispatcher()` is a dispatcher with one connection per origin, through the
 * environment's proxy when one is set (as `NODE_USE_ENV_PROXY=1` does for the built-in one,
 * DEC-0085). It is passed per request (`fetchOver`), never installed globally: Wrangler replaces
 * the global dispatcher with its own when proxy variables are set.
 */
import { Agent, EnvHttpProxyAgent, type Dispatcher } from "undici";

type Environment = Readonly<Record<string, string | undefined>>;

const value = (v: string | undefined): string | undefined => (v === undefined || v === "" ? undefined : v);

export function oneConnectionDispatcher(env: Environment = process.env): Dispatcher {
  const httpsProxy = value(env.HTTPS_PROXY) ?? value(env.https_proxy);
  const httpProxy = value(env.HTTP_PROXY) ?? value(env.http_proxy);
  if (httpsProxy === undefined && httpProxy === undefined) return new Agent({ connections: 1 });
  const noProxy = value(env.NO_PROXY) ?? value(env.no_proxy);
  return new EnvHttpProxyAgent({
    connections: 1,
    ...(httpProxy === undefined ? {} : { httpProxy }),
    ...(httpsProxy === undefined ? {} : { httpsProxy }),
    ...(noProxy === undefined ? {} : { noProxy }),
  });
}

/** A `fetch` whose every request goes over `dispatcher` (Node's `fetch` option, not in the DOM `RequestInit` type). */
export function fetchOver(dispatcher: Dispatcher, base: typeof fetch = globalThis.fetch): typeof fetch {
  return (input, init) => base(input, { ...(init ?? {}), dispatcher } as RequestInit);
}
