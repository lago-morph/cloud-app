/**
 * Just enough MIME (RFC 5322, RFC 2045–2047) to read a framework message back from the mail sink
 * as testing.d.ts's `MailMessage` (mail.md §2 "Reading mail"): the `From`, `To`, `Subject` and
 * `Date` headers (folded lines, encoded words), and the first `text/plain` and `text/html` parts
 * of a single-part or (nested) multipart body, with base64 or quoted-printable transfer encoding
 * and the part's charset. Attachments and everything else are ignored. No Node APIs.
 */
import type { MailMessage } from "./sender.js";

interface Part {
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
}

/** Splits header block and body at the first empty line; header names lowercased, folded lines joined. */
function splitPart(raw: string): Part {
  const text = raw.replace(/\r\n/g, "\n");
  const end = text.indexOf("\n\n");
  const head = end === -1 ? text : text.slice(0, end);
  const body = end === -1 ? "" : text.slice(end + 2);
  const headers = new Map<string, string>();
  for (const line of head.replace(/\n[ \t]+/g, " ").split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return { headers, body };
}

/** A header value's main token and its parameters (`type/sub; charset="x"`). */
function parameters(value: string): { value: string; params: Map<string, string> } {
  const [main = "", ...rest] = value.split(";");
  const params = new Map<string, string>();
  for (const p of rest) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    params.set(p.slice(0, eq).trim().toLowerCase(), p.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1"));
  }
  return { value: main.trim().toLowerCase(), params };
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** A literal (unencoded) character's bytes: the raw message reaches the reader as UTF-8 text. */
function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const binary = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Quoted-printable (RFC 2045 §6.7); `header` also maps `_` to a space (RFC 2047 "Q"). */
function quotedPrintableBytes(text: string, header = false): Uint8Array {
  const source = (header ? text.replace(/_/g, " ") : text).replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i] ?? "";
    const hex = source.slice(i + 1, i + 3);
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      out.push(...utf8Bytes(c));
    }
  }
  return Uint8Array.from(out);
}

/** Decodes RFC 2047 encoded words; whitespace between adjacent encoded words is dropped. */
export function decodeHeader(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, encoding: string, text: string) => {
      const bytes = encoding.toUpperCase() === "B" ? base64Bytes(text) : quotedPrintableBytes(text, true);
      return decodeBytes(bytes, charset.split("*")[0] ?? "utf-8");
    });
}

function decodeBody(part: Part): string {
  const encoding = (part.headers.get("content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  const charset = parameters(part.headers.get("content-type") ?? "text/plain").params.get("charset") ?? "utf-8";
  if (encoding === "base64") return decodeBytes(base64Bytes(part.body), charset);
  if (encoding === "quoted-printable") return decodeBytes(quotedPrintableBytes(part.body), charset);
  return part.body;
}

/** The leaf parts in order, descending into every multipart. */
function leaves(part: Part, depth = 0): Part[] {
  const type = parameters(part.headers.get("content-type") ?? "text/plain");
  const boundary = type.params.get("boundary");
  if (!type.value.startsWith("multipart/") || boundary === undefined || depth > 8) return [part];
  const delimiter = `--${boundary}`;
  const lines = part.body.replace(/\r\n/g, "\n").split("\n");
  const children: string[][] = [];
  let current: string[] | undefined;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === `${delimiter}--`) break;
    if (trimmed === delimiter) {
      current = [];
      children.push(current);
    } else if (current !== undefined) {
      current.push(line);
    }
  }
  return children.flatMap((c) => leaves(splitPart(c.join("\n")), depth + 1));
}

/** The address inside `Name <addr>`, or the value itself. */
function addressOf(value: string): string {
  const m = /<([^>]*)>/.exec(value);
  return (m?.[1] ?? value).trim();
}

export interface ParsedMail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly date?: string;
  readonly text: string;
  readonly html: string;
}

/** Parses a raw message. Missing parts and headers come back as empty strings. */
export function parseMime(raw: string): ParsedMail {
  const top = splitPart(raw);
  let text: string | undefined;
  let html: string | undefined;
  for (const leaf of leaves(top)) {
    const type = parameters(leaf.headers.get("content-type") ?? "text/plain").value;
    const disposition = parameters(leaf.headers.get("content-disposition") ?? "").value;
    if (disposition === "attachment") continue;
    if (type === "text/plain" && text === undefined) text = decodeBody(leaf);
    else if (type === "text/html" && html === undefined) html = decodeBody(leaf);
  }
  const header = (name: string) => decodeHeader(top.headers.get(name) ?? "");
  const date = top.headers.get("date");
  const parsedDate = date === undefined ? Number.NaN : Date.parse(date);
  return {
    from: header("from"),
    to: addressOf(header("to")),
    subject: header("subject"),
    ...(Number.isNaN(parsedDate) ? {} : { date: new Date(parsedDate).toISOString() }),
    text: (text ?? "").replace(/\r\n/g, "\n"),
    html: (html ?? "").replace(/\r\n/g, "\n"),
  };
}

/**
 * A sink message as `MailMessage`: `to` is the recipient the sink stored it under, and `sentAt`
 * the `Date` header, or `storedAt` (the sink's key timestamp) when it has none.
 */
export function sinkMailMessage(raw: string, recipient: string, storedAt: string): MailMessage {
  const parsed = parseMime(raw);
  return { to: recipient, from: parsed.from, subject: parsed.subject, text: parsed.text, html: parsed.html, sentAt: parsed.date ?? storedAt };
}
