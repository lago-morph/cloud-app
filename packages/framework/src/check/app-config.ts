/**
 * CHECK-REQ-006: `verify` never takes its rules from app-editable configuration, and fails when
 * the app's own lint configuration (`eslint.config.*`) disables or weakens a framework rule: a
 * lower severity than the shipped one, or different options.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { shippedRules } from "./config.js";
import type { CheckDiagnostic } from "./engine.js";
import { referenceFor } from "./references.js";
import { PLUGIN_NAME } from "./rule-names.js";

export const APP_LINT_CONFIG_FILES = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", "eslint.config.mts", "eslint.config.cts"];

type Setting = unknown;

function severity(setting: Setting): number | undefined {
  const value = Array.isArray(setting) ? setting[0] : setting;
  if (value === "off" || value === 0) return 0;
  if (value === "warn" || value === 1) return 1;
  if (value === "error" || value === 2) return 2;
  return undefined;
}

function options(setting: Setting): unknown[] {
  return Array.isArray(setting) ? setting.slice(1) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flatten(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) for (const item of value) flatten(item, out);
  else if (isRecord(value)) out.push(value);
}

/** Plugin namespaces under which the app registered this package's plugin (besides its own name). */
function frameworkAliases(configs: readonly Record<string, unknown>[]): Set<string> {
  const aliases = new Set([PLUGIN_NAME]);
  for (const config of configs) {
    const plugins = config["plugins"];
    if (!isRecord(plugins)) continue;
    for (const [alias, plugin] of Object.entries(plugins)) {
      const meta = isRecord(plugin) ? plugin["meta"] : undefined;
      if (isRecord(meta) && meta["name"] === PLUGIN_NAME) aliases.add(alias);
    }
  }
  return aliases;
}

function diagnostic(file: string, rule: string, message: string): CheckDiagnostic {
  return { file, line: 1, column: 1, rule, message, reference: referenceFor(rule) };
}

export async function checkAppLintConfig(appDir: string): Promise<CheckDiagnostic[]> {
  const shipped = shippedRules();
  const out: CheckDiagnostic[] = [];
  for (const file of APP_LINT_CONFIG_FILES) {
    const path = join(appDir, file);
    if (!existsSync(path)) continue;
    let loaded: unknown;
    try {
      const mod: unknown = await import(`${pathToFileURL(path).href}?check=${String(Date.now())}`);
      loaded = await (isRecord(mod) && "default" in mod ? mod["default"] : mod);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      out.push(diagnostic(file, `${PLUGIN_NAME}/lint-config`, `${file} could not be loaded (${reason}); verify must confirm it does not switch framework rules off (CHECK-REQ-006).`));
      continue;
    }
    const configs: Record<string, unknown>[] = [];
    flatten(loaded, configs);
    const aliases = frameworkAliases(configs);
    const reported = new Set<string>();
    for (const config of configs) {
      const rules = config["rules"];
      if (!isRecord(rules)) continue;
      for (const [key, setting] of Object.entries(rules)) {
        const slash = key.lastIndexOf("/");
        const id = slash > 0 && aliases.has(key.slice(0, slash)) ? `${PLUGIN_NAME}/${key.slice(slash + 1)}` : key;
        const expected = shipped[id];
        if (expected === undefined || reported.has(id)) continue;
        const weaker = (severity(setting) ?? 0) < (severity(expected) ?? 2);
        const changed = options(setting).length > 0 && JSON.stringify(options(setting)) !== JSON.stringify(options(expected));
        if (!weaker && !changed) continue;
        reported.add(id);
        const what = weaker ? `turns the framework rule ${id} ${severity(setting) === 0 ? "off" : "down"}` : `changes the options of the framework rule ${id}`;
        out.push(diagnostic(file, id, `${file} ${what} ("${key}": ${JSON.stringify(setting)}); apps cannot switch framework rules off or weaken them (CHECK-REQ-006) — remove the entry.`));
      }
    }
  }
  return out;
}
