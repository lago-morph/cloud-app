/**
 * Helpers for driving `npx <package> dev` from the B-T4 local suite: start/stop, plain
 * HTTP requests over loopback (node:http, so no proxy settings apply and the Host header
 * can be forged), and the listening sockets of the dev process group read from /proc.
 */
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import type { FixtureApp, RunningProcess } from "./app.js";

export interface DevServer {
  readonly process: RunningProcess;
  /** The printed `http://localhost:<port>` origin. */
  readonly origin: string;
  readonly port: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export function http(
  port: number,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; host?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: init.host ?? "localhost", port, path, method: init.method ?? "GET", headers: init.headers ?? {} },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout: ${init.method ?? "GET"} ${path}`)));
    req.end(init.body);
  });
}

/** Starts `dev` and waits until it prints its local URL and answers `/api/hello`. */
export async function startDev(app: FixtureApp, timeoutMs = 240_000): Promise<DevServer> {
  const proc = app.spawnCli(["dev"]);
  const match = await proc.waitFor(/http:\/\/localhost:(\d+)/, timeoutMs);
  const port = Number(match[1]);
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await http(port, "/api/hello");
      if (res.status === 200) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      await proc.stop();
      throw new Error(`dev did not answer ${origin}/api/hello in time:\n${proc.output}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { process: proc, origin, port };
}

// ---- /proc ---------------------------------------------------------------------

function pidsInGroup(pgid: number): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pgid) pids.push(Number(entry));
    } catch {
      /* process went away */
    }
  }
  return pids;
}

function socketInodes(pid: number): Set<string> {
  const inodes = new Set<string>();
  try {
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      try {
        const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
        if (m?.[1]) inodes.add(m[1]);
      } catch {
        /* fd closed */
      }
    }
  } catch {
    /* process went away */
  }
  return inodes;
}

export interface ListeningSocket {
  readonly address: string;
  readonly port: number;
  readonly loopback: boolean;
}

function decode(hex: string, v6: boolean): { address: string; loopback: boolean } {
  if (!v6) {
    const octets = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return { address: octets.join("."), loopback: octets[0] === 127 };
  }
  const upper = hex.toUpperCase();
  const mappedV4 = upper.startsWith("0000000000000000FFFF0000") ? decode(upper.slice(24), false) : undefined;
  if (mappedV4) return { address: `::ffff:${mappedV4.address}`, loopback: mappedV4.loopback };
  return { address: `ipv6:${upper}`, loopback: upper === "00000000000000000000000001000000" };
}

/** TCP sockets in LISTEN state owned by any process of the process group `pgid`. */
export function listeningSockets(pgid: number): ListeningSocket[] {
  const inodes = new Set<string>();
  for (const pid of pidsInGroup(pgid)) for (const inode of socketInodes(pid)) inodes.add(inode);
  const out: ListeningSocket[] = [];
  for (const [file, v6] of [
    ["/proc/net/tcp", false],
    ["/proc/net/tcp6", true],
  ] as const) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10 || cols[3] !== "0A" || !inodes.has(cols[9] ?? "")) continue;
      const [addrHex = "", portHex = "0"] = (cols[1] ?? "").split(":");
      out.push({ ...decode(addrHex, v6), port: parseInt(portHex, 16) });
    }
  }
  return out;
}

/** Resolves true when a TCP connection to address:port succeeds. */
export function canConnect(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: address, port, timeout: 5_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}
