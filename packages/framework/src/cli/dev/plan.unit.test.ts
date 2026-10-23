import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientRoot, devPaths, devServerReadyPort, isAllowedHost, readyLinePort, wranglerDevArgs } from "./plan.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("dev's plan (local.md §2, LOCAL-REQ-002, LOCAL-REQ-004)", () => {
  it("keeps Wrangler's state in <app>/.wrangler/state and reads secrets from <app>/.dev.vars", () => {
    expect(devPaths("/apps/one")).toEqual({
      wranglerConfig: "/apps/one/.framework/local/wrangler.jsonc",
      persistTo: "/apps/one/.wrangler/state",
      platformProxyPersist: "/apps/one/.wrangler/state/v3",
      devVars: "/apps/one/.dev.vars",
      viteCache: "/apps/one/.framework/vite",
    });
  });

  it("[LOCAL-AC-004] runs wrangler on loopback only, with the public origin and an explicit secrets file", () => {
    const args = wranglerDevArgs({ appDir: "/apps/one", publicOrigin: "http://localhost:5199" });
    expect(args).toEqual([
      "dev",
      "--config", "/apps/one/.framework/local/wrangler.jsonc",
      "--persist-to", "/apps/one/.wrangler/state",
      "--env-file", "/apps/one/.dev.vars",
      "--ip", "127.0.0.1",
      "--port", "0",
      "--inspector-ip", "127.0.0.1",
      "--inspector-port", "0",
      "--var", "FRAMEWORK_PUBLIC_ORIGIN:http://localhost:5199",
      "--show-interactive-dev-session=false",
      "--local",
    ]);
  });

  // MIG-AC-002 root cause (2026-10-20-mig-ac-002-workerd-crash.md): a port picked and released before
  // workerd binds it can be taken in between. Port 0 lets workerd bind a free port itself, and dev
  // learns the port from wrangler's IPC `DEV_SERVER_READY` message (fallback: its `Ready on` line).
  it("passes --port 0 and --inspector-port 0 on loopback, so no port is picked before workerd binds it", () => {
    const args = wranglerDevArgs({ appDir: "/apps/one", publicOrigin: "http://localhost:5199" });
    expect(args[args.indexOf("--port") + 1]).toBe("0");
    expect(args[args.indexOf("--inspector-port") + 1]).toBe("0");
    expect(args[args.indexOf("--ip") + 1]).toBe("127.0.0.1");
    expect(args[args.indexOf("--inspector-ip") + 1]).toBe("127.0.0.1");
  });

  it("reads the Worker's bound port from wrangler's IPC DEV_SERVER_READY message", () => {
    // wrangler 4.149.0 sends the message as a JSON string (cli.js:374836-374842).
    expect(devServerReadyPort(JSON.stringify({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: 44443 }))).toBe(44443);
    expect(devServerReadyPort({ event: "DEV_SERVER_READY", ip: "127.0.0.1", port: 44443 })).toBe(44443);
    for (const other of [
      JSON.stringify({ event: "OTHER", port: 44443 }),
      JSON.stringify({ event: "DEV_SERVER_READY", port: 0 }),
      JSON.stringify({ event: "DEV_SERVER_READY", port: "44443" }),
      "not json",
      undefined,
      null,
      42,
    ]) {
      expect(devServerReadyPort(other), String(other)).toBeUndefined();
    }
  });

  it("falls back to wrangler's `Ready on http://127.0.0.1:<port>` line", () => {
    expect(readyLinePort("[wrangler:info] Ready on http://127.0.0.1:44443")).toBe(44443);
    expect(readyLinePort("Ready on http://localhost:8787")).toBeUndefined();
    expect(readyLinePort("Ready on http://127.0.0.1:0")).toBeUndefined();
    expect(readyLinePort("Your Worker has access to the following bindings:")).toBeUndefined();
  });

  it("[LOCAL-AC-004] accepts only Host: localhost:<port>", () => {
    expect(isAllowedHost("localhost:5199", 5199)).toBe(true);
    for (const host of [undefined, "", "evil.example", "localhost", "localhost:5200", "127.0.0.1:5199", "localhost.evil.example:5199", "LOCALHOST:5199x"]) {
      expect(isAllowedHost(host, 5199), String(host)).toBe(false);
    }
  });

  it("serves the client from the app root when it holds index.html, else from src/client/", () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-plan-"));
    dirs.push(dir);
    mkdirSync(join(dir, "src", "client"), { recursive: true });
    writeFileSync(join(dir, "src", "client", "index.html"), "<html></html>");
    expect(clientRoot(dir)).toBe(join(dir, "src", "client"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    expect(clientRoot(dir)).toBe(dir);
  });
});
