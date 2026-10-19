/**
 * Files (FILES), server side. Behavior: docs/components/files.md.
 * Browser-side transfer helpers are in client.d.ts.
 */

export interface FileInfo {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface FileContent extends FileInfo {
  readonly body: ReadableStream<Uint8Array>;
}

export interface FilesListOptions {
  /** Page size; default and maximum in the parameters register (PAR-231, PAR-232). */
  readonly limit?: number;
  readonly cursor?: string;
}

export interface FilesListPage {
  readonly items: readonly FileInfo[];
  readonly nextCursor: string | null;
}

/**
 * Opaque, short-lived permission for the browser to transfer one file. Created by app
 * server code after it has authorized the transfer, returned to the browser as JSON,
 * and consumed by the browser helpers in client.d.ts. Its contents are not part of
 * the contract.
 */
declare const ticketBrand: unique symbol;
export interface UploadTicket { readonly [ticketBrand]: "upload" }
export interface DownloadTicket { readonly [ticketBrand]: "download" }

export interface UploadTicketOptions {
  /** Content type the upload must declare; default `application/octet-stream`. */
  readonly contentType?: string;
}

export interface FilesService {
  /** Whole-file create or replace from server code. */
  put(name: string, bytes: Uint8Array, options?: { readonly contentType?: string }): Promise<void>;
  /** Content and metadata, or null if absent. */
  get(name: string): Promise<FileContent | null>;
  /** Metadata only, or null if absent. */
  head(name: string): Promise<FileInfo | null>;
  /** Deleting an absent file succeeds. */
  delete(name: string): Promise<void>;
  /** Files whose names start with `prefix` (literal), in code point order. */
  list(prefix: string, options?: FilesListOptions): Promise<FilesListPage>;
  /** Permission for the browser to upload (create or replace) `name`. */
  createUploadTicket(name: string, options?: UploadTicketOptions): Promise<UploadTicket>;
  /** Permission for the browser to download `name`. Throws FILES.NOT_FOUND if absent. */
  createDownloadTicket(name: string): Promise<DownloadTicket>;
}
