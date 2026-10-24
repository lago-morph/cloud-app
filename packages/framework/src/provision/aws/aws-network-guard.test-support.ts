/**
 * Test guard: no unit test may reach AWS (plan-aws.md §3 shared rules). While installed, every
 * outgoing connection or request whose host is `*.amazonaws.com` (or `amazonaws.com.cn`) is
 * refused before a socket opens, and recorded. Tests assert the record stays empty.
 *
 * It patches the module objects Node's own clients call at request time: `https.request`/`get`,
 * `http.request`/`get`, `tls.connect`, `net.connect`/`createConnection`, and global `fetch`.
 * SDK v3's `NodeHttpHandler` calls `https.request` through the module object, so it is caught.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const AWS_HOST = /(^|\.)amazonaws\.com(\.cn)?\.?$/i;

export interface AwsNetworkGuard {
  /** Hosts of the refused attempts, in order. */
  readonly attempts: string[];
  uninstall(): void;
}

function hostOf(args: readonly unknown[]): string | undefined {
  for (const a of args) {
    if (typeof a === "string") {
      try {
        return new URL(a).hostname;
      } catch {
        if (AWS_HOST.test(a)) return a;
      }
    } else if (a instanceof URL) {
      return a.hostname;
    } else if (typeof a === "object" && a !== null) {
      const o = a as { hostname?: unknown; host?: unknown; servername?: unknown };
      for (const v of [o.hostname, o.host, o.servername]) if (typeof v === "string" && v !== "") return v.replace(/:\d+$/, "");
    }
  }
  return undefined;
}

export function installAwsNetworkGuard(): AwsNetworkGuard {
  const attempts: string[] = [];
  const restores: Array<() => void> = [];
  const refuse = (host: string): never => {
    attempts.push(host);
    throw new Error(`blocked: a unit test tried to reach AWS (${host})`);
  };
  const patch = (target: object, key: string): void => {
    const obj = target as Record<string, unknown>;
    const original = obj[key] as (...args: unknown[]) => unknown;
    obj[key] = function guarded(this: unknown, ...args: unknown[]) {
      const host = hostOf(args);
      if (host !== undefined && AWS_HOST.test(host)) refuse(host);
      return original.apply(this, args);
    };
    restores.push(() => {
      obj[key] = original;
    });
  };
  patch(https, "request");
  patch(https, "get");
  patch(http, "request");
  patch(http, "get");
  patch(tls, "connect");
  patch(net, "connect");
  patch(net, "createConnection");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).hostname;
    if (AWS_HOST.test(host)) refuse(host);
    return originalFetch(input, init);
  }) as typeof fetch;
  restores.push(() => {
    globalThis.fetch = originalFetch;
  });
  return {
    attempts,
    uninstall: () => {
      for (const r of restores.reverse()) r();
    },
  };
}
