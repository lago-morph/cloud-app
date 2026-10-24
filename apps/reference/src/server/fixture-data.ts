/**
 * The migration data fixture (E2E-010, MIG-AC-003): a few rows and files, the same in every
 * schema version. Two children share the label `shared`, so the `unique-fail` overlay's unique
 * constraint on `children.label` fails over this data.
 */
export interface FixtureParent {
  readonly name: string;
  readonly note: string | null;
}

export interface FixtureChild {
  /** The parent's `name`. */
  readonly parent: string;
  readonly label: string;
}

export interface FixtureFile {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: () => Uint8Array;
}

export const FIXTURE_PARENTS: readonly FixtureParent[] = [
  { name: "alpha", note: "first parent" },
  { name: "beta", note: null },
  { name: "gamma", note: "Ünïcødé — ünd ‘quotes’" },
];

export const FIXTURE_CHILDREN: readonly FixtureChild[] = [
  { parent: "alpha", label: "shared" },
  { parent: "alpha", label: "a2" },
  { parent: "beta", label: "shared" },
  { parent: "beta", label: "b2" },
  { parent: "gamma", label: "g1" },
];

export const FIXTURE_FILES: readonly FixtureFile[] = [
  { name: "fixture/hello.txt", contentType: "text/plain", bytes: () => new TextEncoder().encode("hello fixture\n") },
  { name: "fixture/all-bytes.bin", contentType: "application/octet-stream", bytes: () => Uint8Array.from({ length: 256 }, (_, i) => i) },
];
