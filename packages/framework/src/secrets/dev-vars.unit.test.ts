import { describe, expect, it } from "vitest";
import { addMissingDevSecrets, setDevVar } from "./dev-vars.js";

/**
 * How Wrangler (PAR-101, 4.149.0) reads `.dev.vars`: its bundled dotenv 16.3.1 `parse` followed by
 * dotenv-expand 12.0.2 `expand` (node_modules/wrangler/wrangler-dist/cli.js, `loadDotEnv`).
 * Transcribed here so the tests check what the Worker will actually see.
 */
function wranglerRead(text: string): Record<string, string> {
  const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
  const parsed: Record<string, string> = {};
  const lines = text.replace(/\r\n?/gm, "\n");
  let match: RegExpExecArray | null;
  while ((match = LINE.exec(lines)) != null) {
    let value = (match[2] ?? "").trim();
    const maybeQuote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (maybeQuote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    parsed[match[1]!] = value;
  }
  // dotenv-expand: `$NAME` / `${NAME}` not preceded by a backslash are replaced, then `\$` → `$`.
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    const expanded = raw.replace(/(?<!\\)\$\{([^{}]+)\}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a?: string, b?: string) => out[(a ?? b)!] ?? "");
    out[key] = expanded.replace(/\\\$/g, "$");
  }
  return out;
}

const dummy = (label: string) => `${label}-${crypto.randomUUID()}`;

describe("generating missing development-only framework secrets (secrets.md §2 Local)", () => {
  it("adds the session key and the local ticket key, each from at least PAR-253 (32) random bytes", () => {
    const { text, added } = addMissingDevSecrets("");
    expect([...added].sort()).toEqual(["SECRET_FRAMEWORK_LOCAL_TICKET_KEY", "SECRET_FRAMEWORK_SESSION_KEY"]);
    const read = wranglerRead(text);
    const session = read.SECRET_FRAMEWORK_SESSION_KEY!;
    const ticket = read.SECRET_FRAMEWORK_LOCAL_TICKET_KEY!;
    expect(session).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(session).not.toBe(ticket);
    expect(addMissingDevSecrets("").text).not.toBe(text);
  });

  it("never overwrites an existing value and changes nothing when all are present", () => {
    const session = dummy("s");
    const ticket = dummy("t");
    const before = `SECRET_API_KEY=a\nSECRET_FRAMEWORK_SESSION_KEY=${session}\nSECRET_FRAMEWORK_LOCAL_TICKET_KEY='${ticket}'\n`;
    expect(addMissingDevSecrets(before)).toEqual({ text: before, added: [] });
    const partial = addMissingDevSecrets(`SECRET_FRAMEWORK_SESSION_KEY=${session}\n`);
    expect(partial.added).toEqual(["SECRET_FRAMEWORK_LOCAL_TICKET_KEY"]);
    expect(wranglerRead(partial.text).SECRET_FRAMEWORK_SESSION_KEY).toBe(session);
  });

  it("fills an assignment whose value is empty (the Worker would see no value)", () => {
    const { text, added } = addMissingDevSecrets("SECRET_FRAMEWORK_SESSION_KEY=\n");
    expect(added).toContain("SECRET_FRAMEWORK_SESSION_KEY");
    expect(wranglerRead(text).SECRET_FRAMEWORK_SESSION_KEY).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });
});

describe("[SEC-AC-003] writing SECRET_<NAME> into .dev.vars", () => {
  it("adds the assignment to an empty file and Wrangler reads the value back", () => {
    const value = dummy("v");
    const text = setDevVar("", "SECRET_API_KEY", value);
    expect(text.endsWith("\n")).toBe(true);
    expect(wranglerRead(text)).toEqual({ SECRET_API_KEY: value });
  });

  it.each([
    ["dollar signs", "a$HOME${PATH}b\\$c$"],
    ["a single quote", "it's"],
    ["single and double quotes", `it's "x"`],
    ["all three quote kinds", "'\"`"],
    ["quotes and a backslash-n", "'\"\\n"],
    ["a hash and surrounding spaces", "  #not a comment  "],
    ["backslashes", "a\\b\\\\c\\"],
    ["unicode", "pässwörd-🔑"],
  ])("a value with %s reads back unchanged", (_label, value) => {
    const text = setDevVar("", "SECRET_API_KEY", value);
    expect(wranglerRead(text).SECRET_API_KEY).toBe(value);
  });

  it.each([
    ["a line feed", "a\nb"],
    ["a carriage return", "a\rb"],
    ["all three quote kinds and a hash between them", "a'b\"c`d#e"],
  ])("a value with %s is refused (it cannot be stored as one .dev.vars value)", (_label, value) => {
    expect(() => setDevVar("", "SECRET_API_KEY", value)).toThrow(/cannot be stored in \.dev\.vars/);
    // The refusal names the location, never the value.
    expect(() => setDevVar("", "SECRET_API_KEY", value)).not.toThrow(value);
  });

  it("replaces an existing assignment (also a multi-line quoted one) and keeps other lines", () => {
    const other = dummy("o");
    const before = `# local secrets\nSECRET_OTHER=${other}\nSECRET_API_KEY="old\nvalue"\nexport SECRET_THIRD='t'\r\n`;
    const value = dummy("new");
    const text = setDevVar(before, "SECRET_API_KEY", value);
    expect(text.startsWith(`# local secrets\nSECRET_OTHER=${other}\n`)).toBe(true);
    expect(text).not.toContain("old");
    expect(wranglerRead(text)).toEqual({ SECRET_OTHER: other, SECRET_API_KEY: value, SECRET_THIRD: "t" });
  });

  it("keeps blank lines before a replaced assignment", () => {
    expect(setDevVar("A=1\n\n  SECRET_API_KEY=old\nB=2\n", "SECRET_API_KEY", "v")).toBe("A=1\n\nSECRET_API_KEY='v'\nB=2\n");
  });

  it("appends after a last line that has no line ending", () => {
    const text = setDevVar("SECRET_OTHER=o", "SECRET_API_KEY", "v");
    expect(wranglerRead(text)).toEqual({ SECRET_OTHER: "o", SECRET_API_KEY: "v" });
  });
});
