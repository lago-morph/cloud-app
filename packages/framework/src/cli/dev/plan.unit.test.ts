import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientRoot, devPaths, isAllowedHost, wranglerDevArgs } from "./plan.js";

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
    const args = wranglerDevArgs({ appDir: "/apps/one", port: 8801, inspectorPort: 9301, publicOrigin: "http://localhost:5199" });
    expect(args).toEqual([
      "dev",
      "--config", "/apps/one/.framework/local/wrangler.jsonc",
      "--persist-to", "/apps/one/.wrangler/state",
      "--env-file", "/apps/one/.dev.vars",
      "--ip", "127.0.0.1",
      "--port", "8801",
      "--inspector-ip", "127.0.0.1",
      "--inspector-port", "9301",
      "--var", "FRAMEWORK_PUBLIC_ORIGIN:http://localhost:5199",
      "--show-interactive-dev-session=false",
      "--local",
    ]);
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
