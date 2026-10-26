/**
 * The runtime `FilesService` (FILES-REQ-001, FILES-REQ-002, FILES-REQ-006 server part) over the
 * target's object store. Target-neutral: local and Cloudflare pass the R2 Worker binding as the
 * store; each target supplies its own ticket issuer. Workers-compatible (no Node APIs).
 */
import { FrameworkError } from "../core/errors.js";
import type { DownloadTicket, FileContent, FileInfo, FilesService, UploadTicket } from "./public.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { logFailure } from "../log/failures.js";
import type { LogService } from "../log/public.js";
import { checkName, checkPrefix } from "./names.js";

/** Object metadata as the store reports it (the R2 binding's shape). */
export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly httpMetadata?: { readonly contentType?: string | undefined } | undefined;
}

export interface StoredObjectBody extends StoredObject {
  readonly body: ReadableStream<Uint8Array>;
}

export interface StoreListOptions {
  readonly prefix?: string;
  readonly limit?: number;
  readonly startAfter?: string;
  readonly include?: ("httpMetadata")[];
}

/** The subset of the R2 Worker binding FILES uses. */
export interface FilesStore {
  put(key: string, value: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<StoredObjectBody | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  list(options: StoreListOptions): Promise<{ readonly objects: readonly StoredObject[]; readonly truncated: boolean }>;
}

/** Creates the browser's transfer permissions; one per target (local route, signed storage URLs). */
export interface TicketIssuer {
  upload(name: string, contentType: string): Promise<unknown>;
  /**
   * `contentType` is the stored file's content type, so an issuer can serve the common raster
   * image types `inline` (DEC-0535); without it a download is an `attachment`. An issuer that serves
   * the stored type itself (the local route) may ignore it.
   */
  download(name: string, contentType?: string): Promise<unknown>;
}

export interface FilesServiceOptions {
  readonly store: FilesStore;
  readonly tickets: TicketIssuer;
  /** The request's log, for the LOG-REQ-005 entry of a `FILES.UNAVAILABLE` failure. */
  readonly log?: LogService;
}

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";
/** PAR-231: default list page size. */
export const DEFAULT_PAGE_SIZE = 100;
/** PAR-232: maximum list page size (also the most R2 and S3 return per call). */
export const MAX_PAGE_SIZE = 1000;

/** The page size for a requested limit: default PAR-231, clamped to 1…PAR-232. */
function pageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE_SIZE);
}

function infoOf(object: StoredObject): FileInfo {
  return { name: object.key, size: object.size, contentType: object.httpMetadata?.contentType ?? DEFAULT_CONTENT_TYPE };
}

/**
 * The store with every failure that is not already a `FrameworkError` turned into
 * `FILES.UNAVAILABLE` (FILES-REQ-006), logged once through `logFailure` so a failure the app
 * catches is still recorded. The store's error is named in the message (log only: 503 responses
 * carry the catalogue meaning).
 */
function guarded(store: FilesStore, log: LogService | undefined): FilesStore {
  const call = async <T>(operation: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (thrown) {
      if (thrown instanceof FrameworkError) throw thrown;
      const cause = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
      const failure = new FrameworkError("FILES.UNAVAILABLE", `file storage could not be used (${operation}): ${cause}`);
      if (log !== undefined) logFailure(log, failure);
      throw failure;
    }
  };
  return {
    put: (key, value, options) => call("put", () => store.put(key, value, options)),
    get: (key) => call("get", () => store.get(key)),
    head: (key) => call("head", () => store.head(key)),
    delete: (key) => call("delete", () => store.delete(key)),
    list: (options) => call("list", () => store.list(options)),
  };
}

export function createFilesService(options: FilesServiceOptions): FilesService {
  const store = guarded(options.store, options.log);
  return {
    async put(name, bytes, putOptions) {
      checkName(name);
      await store.put(name, bytes, { httpMetadata: { contentType: putOptions?.contentType ?? DEFAULT_CONTENT_TYPE } });
    },
    async get(name) {
      checkName(name);
      const object = await store.get(name);
      return object === null ? null : ({ ...infoOf(object), body: object.body } satisfies FileContent);
    },
    async head(name) {
      checkName(name);
      const object = await store.head(name);
      return object === null ? null : infoOf(object);
    },
    async delete(name) {
      checkName(name);
      await store.delete(name);
    },
    async list(prefix, listOptions) {
      checkPrefix(prefix);
      const limit = pageSize(listOptions?.limit);
      let after = listOptions?.cursor === undefined ? undefined : decodeCursor(prefix, listOptions.cursor);
      // One item beyond the page tells whether another page exists; the store may return short
      // truncated pages (R2 does when metadata is included), so keep asking until it is done.
      const found: StoredObject[] = [];
      for (;;) {
        const page = await store.list({
          prefix,
          limit: Math.min(limit + 1 - found.length, MAX_PAGE_SIZE),
          include: ["httpMetadata"],
          ...(after === undefined ? {} : { startAfter: after }),
        });
        found.push(...page.objects);
        const last = page.objects.at(-1);
        if (!page.truncated || last === undefined || found.length > limit) break;
        after = last.key;
      }
      const items = found.slice(0, limit).map(infoOf);
      const lastItem = items.at(-1);
      return { items, nextCursor: found.length > limit && lastItem !== undefined ? encodeCursor(prefix, lastItem.name) : null };
    },
    async createUploadTicket(name, ticketOptions) {
      checkName(name);
      // Reachability check, so a ticket is never issued for storage that cannot take the upload
      // (FILES-AC-006 server part covers every server operation).
      await store.head(name);
      return (await options.tickets.upload(name, ticketOptions?.contentType ?? DEFAULT_CONTENT_TYPE)) as UploadTicket;
    },
    async createDownloadTicket(name) {
      checkName(name);
      const stored = await store.head(name);
      if (stored === null) throw new FrameworkError("FILES.NOT_FOUND", `no file named ${JSON.stringify(name)}`);
      return (await options.tickets.download(name, infoOf(stored).contentType)) as DownloadTicket;
    },
  };
}
