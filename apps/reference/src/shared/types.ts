/** Response and request shapes shared by the server routes, the browser pages and the tests. */

export interface ParentDump {
  readonly name: string;
  /** Absent in versions that dropped the column. */
  readonly note?: string | null;
}

export interface ChildDump {
  /** The parent's `name`. */
  readonly parent: string;
  readonly label: string;
  /** Present only in versions that have the column. */
  readonly rank?: number;
}

export interface FileDump {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  /** Lowercase hex SHA-256 of the content. */
  readonly sha256: string;
}

export interface FixtureDump {
  readonly version: string;
  readonly parents: readonly ParentDump[];
  readonly children: readonly ChildDump[];
  readonly files: readonly FileDump[];
}

export interface StoredFile {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface FilePage {
  readonly items: readonly StoredFile[];
  readonly nextCursor: string | null;
}

export interface ConfigValues {
  readonly greeting: string;
  readonly pageSize: number;
  readonly featureOn: boolean;
  readonly tags: readonly string[];
}
