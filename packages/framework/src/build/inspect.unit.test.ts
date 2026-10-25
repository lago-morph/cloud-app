import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { ALLOWED_NODE_MODULES, disallowedNodeModules, nodeModulesIn } from "./inspect.js";

describe("CF-REQ-003: the Node.js modules a Worker bundle may reference (DEC-0516)", () => {
  it("allows exactly node:crypto and node:async_hooks", () => {
    expect([...ALLOWED_NODE_MODULES].sort()).toEqual(["node:async_hooks", "node:crypto"]);
  });

  it(tag("CF-AC-003", "a bundle importing only node:crypto and node:async_hooks passes, however they are referenced"), () => {
    const bundle = [
      'import{scrypt as a,randomBytes as b}from"node:crypto";',
      'const c=globalThis.process?.getBuiltinModule?.("node:async_hooks");',
      'const d=()=>import("node:async_hooks");',
      'import"crypto";',
    ].join("");
    expect(nodeModulesIn(bundle)).toEqual(["node:async_hooks", "node:crypto"]);
    expect(disallowedNodeModules(bundle)).toEqual([]);
  });

  it(tag("CF-AC-003", "any other node: specifier or bare built-in is reported, by its node: name"), () => {
    const bundle = [
      'import{readFileSync as a}from"node:fs";',
      'import*as b from"path";',
      'const c=require("child_process");',
      'const d=import("fs/promises");',
      'const e=process.getBuiltinModule("node:sqlite");',
      'export{x}from"node:worker_threads";',
    ].join("");
    expect(disallowedNodeModules(bundle)).toEqual(["node:child_process", "node:fs", "node:fs/promises", "node:path", "node:sqlite", "node:worker_threads"]);
  });

  it("ordinary strings that only resemble module names are not references", () => {
    expect(nodeModulesIn('const a="fs",b="path to file",c={crypto:1},d="nodejs_compat";')).toEqual([]);
  });
});
