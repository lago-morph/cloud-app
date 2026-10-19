/** Response and request shapes shared by the server routes and the browser pages. */

export interface Greeting {
  readonly greeting: string;
}

export interface Note {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface NoteList {
  readonly notes: readonly Note[];
}

export interface Status {
  readonly status: string | null;
}

export interface StoredFile {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface FileList {
  readonly files: readonly StoredFile[];
}

export interface SecretCheck {
  readonly configured: boolean;
}

