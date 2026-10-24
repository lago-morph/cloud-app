/**
 * The two S3 XML bodies the AWS store reads: a `ListObjectsV2` result and an error. S3's XML is
 * flat and machine-generated, so a small tag reader suffices (Lambda has no DOM parser and the
 * framework adds no XML dependency). The listing is requested with `encoding-type=url`, so keys
 * arrive URL-encoded (S3 encodes a space as `+`, and `+` itself as `%2B`); a name may hold
 * characters XML 1.0 cannot carry (U+FFFE, U+FFFF). Workers-compatible.
 */

const ENTITY: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML character data with its entity and character references resolved. */
export function xmlText(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    return ENTITY[ref] ?? whole;
  });
}

/** The text of every `<tag>…</tag>` directly in `xml`, in order. */
function elements(xml: string, tag: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>|<${tag}\\s*/>`, "g");
  for (const match of xml.matchAll(pattern)) found.push(match[1] ?? "");
  return found;
}

function first(xml: string, tag: string): string | undefined {
  const [value] = elements(xml, tag);
  return value === undefined ? undefined : xmlText(value);
}

/** A key of an `encoding-type=url` response. */
function urlDecodeKey(encoded: string): string {
  return decodeURIComponent(encoded.replaceAll("+", " "));
}

export interface ListedObject {
  readonly key: string;
  readonly size: number;
}

export interface ListPage {
  readonly objects: readonly ListedObject[];
  readonly truncated: boolean;
}

/** Thrown for a body that is not the expected S3 XML (storage misbehaving, not a FILES error). */
export class S3XmlError extends Error {
  override readonly name = "S3XmlError";
}

/** The objects and truncation of a `ListObjectsV2` result, keys decoded when S3 says it encoded them. */
export function parseListObjectsV2(xml: string): ListPage {
  if (!/<ListBucketResult[\s>]/.test(xml)) throw new S3XmlError("the S3 listing response is not a ListBucketResult");
  const encoded = first(xml, "EncodingType") === "url";
  const objects = elements(xml, "Contents").map((entry) => {
    const rawKey = first(entry, "Key");
    const size = Number(first(entry, "Size"));
    if (rawKey === undefined || !Number.isSafeInteger(size) || size < 0) throw new S3XmlError("an S3 listing entry has no key or size");
    return { key: encoded ? urlDecodeKey(rawKey) : rawKey, size };
  });
  const truncated = first(xml, "IsTruncated");
  if (truncated !== "true" && truncated !== "false") throw new S3XmlError("the S3 listing response has no IsTruncated");
  return { objects, truncated: truncated === "true" };
}

/** The `<Code>` of an S3 error body, if it is one. */
export function errorCode(xml: string): string | undefined {
  const error = elements(xml, "Error")[0];
  return error === undefined ? undefined : first(error, "Code");
}
