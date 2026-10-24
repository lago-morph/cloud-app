/**
 * The skill as a Claude Code plugin: `/plugin marketplace add lago-morph/cloud-app`, then
 * `/plugin install prototype-framework@lago-morph`.
 *
 * Checks `.claude-plugin/marketplace.json` (repository root) and `skill/.claude-plugin/plugin.json`
 * against the fields and rules the Claude Code documentation gives (fetched 2026-10-24):
 * - https://code.claude.com/docs/en/plugins/marketplace-reference.md (top-level fields, plugin
 *   entries, reserved names, relative-path sources);
 * - https://code.claude.com/docs/en/plugins-reference (plugin.json fields, `name`, path rules,
 *   standard layout: "A plugin with SKILL.md at its root, no skills/, and no skills key loads as a
 *   single skill").
 * `claude plugin validate` is the authoritative check; it runs too when the `claude` CLI is on PATH.
 * Decision record: ai/implementation/decisions/distribution.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { read, REPO_ROOT, ROUTER, SKILL_DIR } from "./support.js";

type Json = Record<string, unknown>;
const json = (path: string): Json => JSON.parse(read(path)) as Json;

const MARKETPLACE_FILE = join(REPO_ROOT, ".claude-plugin", "marketplace.json");
const PLUGIN_FILE = join(SKILL_DIR, ".claude-plugin", "plugin.json");

/** marketplace-reference "Top-level fields". */
const MARKETPLACE_FIELDS = new Set(["$schema", "name", "owner", "plugins", "description", "version", "metadata", "forceRemoveDeletedPlugins", "allowCrossMarketplaceDependenciesOn", "renames"]);
/** marketplace-reference "Plugin entries": the entry's own fields plus the plugin.json fields it accepts. */
const ENTRY_FIELDS = new Set(["name", "source", "description", "version", "category", "tags", "strict", "relevance", "dependencies", "defaultEnabled", "displayName", "metadata", "headers", "headersHelper", "author", "homepage", "repository", "license", "keywords", "commands", "agents", "skills", "hooks", "mcpServers", "lspServers", "outputStyles", "userConfig", "channels"]);
/** plugins-reference "Fields". */
const PLUGIN_FIELDS = new Set(["$schema", "name", "displayName", "version", "description", "author", "homepage", "repository", "license", "keywords", "metadata", "icon", "documentationUrl", "supportUrl", "privacyPolicyUrl", "termsOfServiceUrl", "defaultEnabled", "dependencies", "settings", "userConfig", "types", "channels", "skills", "commands", "agents", "hooks", "mcpServers", "lspServers", "outputStyles", "workflows", "experimental"]);
/** "letters, digits, `.`, `_`, and `-`, starting with a letter or digit, and no `..`". */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** marketplace-reference "Reserved names" (the fixed list; the rule for look-alikes is checked below). */
const RESERVED_MARKETPLACES = new Set(["claude-code-marketplace", "claude-code-plugins", "claude-plugins-official", "anthropic-marketplace", "anthropic-plugins", "agent-skills", "anthropic-agent-skills", "life-sciences", "knowledge-work-plugins", "claude-for-legal", "claude-for-financial-services", "financial-services-plugins", "first-party-plugins", "claude-tag-plugins", "claude-community", "claude-plugins-community", "healthcare", "anthropic-plugin-directory", "claude-plugin-directory", "inline", "builtin", "skills-dir", "synced", "claude-plugin-test", "npm", "pip", "uv", "cargo", "github", "gh"]);

const marketplace = json(MARKETPLACE_FILE);
const plugins = (marketplace.plugins ?? []) as Json[];

describe("Claude Code marketplace manifest (.claude-plugin/marketplace.json)", () => {
  it("has only documented top-level fields, with name, owner.name and plugins", () => {
    expect(Object.keys(marketplace).filter((k) => !MARKETPLACE_FIELDS.has(k))).toEqual([]);
    expect(typeof marketplace.description).toBe("string");
    const owner = marketplace.owner as Json;
    expect(typeof owner?.name === "string" && owner.name.trim() !== "").toBe(true);
    expect(Array.isArray(marketplace.plugins) && plugins.length > 0).toBe(true);
  });

  it("is named lago-morph: a valid, unreserved marketplace name (the part after @ in the install id)", () => {
    const name = marketplace.name as string;
    expect(name).toBe("lago-morph");
    expect(ID.test(name) && !name.includes("..")).toBe(true);
    expect(RESERVED_MARKETPLACES.has(name.toLowerCase())).toBe(false);
    expect(/claude|anthropic/i.test(name) || name.startsWith("claudeai-")).toBe(false);
  });

  it("lists each plugin with a valid unique name and a relative ./ source inside the repository", () => {
    const names = plugins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of plugins) {
      expect(Object.keys(p).filter((k) => !ENTRY_FIELDS.has(k)), `entry ${String(p.name)}`).toEqual([]);
      expect(ID.test(String(p.name))).toBe(true);
      const source = p.source;
      expect(typeof source).toBe("string");
      expect(String(source).startsWith("./")).toBe(true);
      expect(String(source).split("/")).not.toContain("..");
      expect(String(source)).not.toContain("\\");
      expect(existsSync(join(REPO_ROOT, String(source))), `source ${String(source)}`).toBe(true);
    }
  });

  it("lists the prototype-framework plugin from skill/", () => {
    expect(plugins.map((p) => [p.name, p.source])).toEqual([["prototype-framework", "./skill"]]);
  });
});

describe("Claude Code plugin manifest (skill/.claude-plugin/plugin.json)", () => {
  const manifest = json(PLUGIN_FILE);

  it("has only documented fields and a kebab-case name equal to the marketplace entry's", () => {
    expect(Object.keys(manifest).filter((k) => !PLUGIN_FIELDS.has(k))).toEqual([]);
    expect(manifest.name).toBe(plugins[0]?.name);
    expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(manifest.name))).toBe(true);
  });

  it("does not use a name reserved for Anthropic's own plugins", () => {
    const name = String(manifest.name).toLowerCase();
    expect(/^(claude|anthropic|anthropics|cc-plugin)-/.test(name)).toBe(false);
    expect(["claude", "anthropic", "anthropics", "claude-code", "claude-mods"]).not.toContain(name);
    expect(/\b(claude|anthropics?)\b/.test(name.replace(/-/g, " "))).toBe(false);
  });

  it("has a description, an author with a name, a parseable homepage and an SPDX license", () => {
    expect(typeof manifest.description === "string" && manifest.description !== "").toBe(true);
    expect(typeof (manifest.author as Json)?.name).toBe("string");
    expect(() => new URL(String(manifest.homepage))).not.toThrow();
    expect(manifest.license).toBe("MIT");
  });

  it("is versioned in lockstep with the framework package", () => {
    const fw = json(join(REPO_ROOT, "packages", "framework", "package.json"));
    expect(manifest.version).toBe(fw.version);
    expect(plugins[0]?.version, "set the version in plugin.json only (it overrides the entry's)").toBeUndefined();
  });

  it("loads skill/SKILL.md as its one skill: SKILL.md at the plugin root, no skills/ folder, no component keys", () => {
    expect(existsSync(ROUTER)).toBe(true);
    expect(existsSync(join(SKILL_DIR, "skills"))).toBe(false);
    for (const key of ["skills", "commands", "agents", "hooks", "mcpServers", "lspServers", "outputStyles", "workflows"]) {
      expect(manifest[key], key).toBeUndefined();
    }
    expect(readdirSync(join(SKILL_DIR, ".claude-plugin"))).toEqual(["plugin.json"]);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(ROUTER, "utf8"))?.[1] ?? "";
    expect(front).toMatch(/^name: prototype-framework$/m);
    expect(front).toMatch(/^description: \S/m);
  });
});

const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
describe.skipIf(claude.status !== 0)("claude plugin validate (when the claude CLI is installed)", () => {
  for (const dir of [".", "skill"]) {
    it(`passes for ${dir}`, () => {
      const r = spawnSync("claude", ["plugin", "validate", dir], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/Validation passed/);
    });
  }
});
