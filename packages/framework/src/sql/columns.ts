/**
 * Portable column helpers (sql.md §2.1). A builder is a dialect-neutral column spec;
 * `defineTable` turns specs into Drizzle columns of the process's dialect.
 */
import { FrameworkError } from "../core/errors.js";
import type { Column, ColumnBuilder } from "./types.js";
import { checkValue, type ColumnKind } from "./values.js";

export interface ColumnSpec {
  readonly kind: ColumnKind;
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly hasDefault: boolean;
  /** Present only when `hasDefault`; already checked against the column rule. */
  readonly defaultValue?: unknown;
  /** `ref()` only: returns the referenced `id()` column, resolved lazily. */
  readonly target?: () => unknown;
  /**
   * `ref()` only: set when it was given anything after its target (e.g. a cast-through
   * `{ onDelete }`). `defineTable` rejects it, naming the table and key (DEC-0132).
   */
  readonly extraRefArguments?: true;
}

const specs = new WeakMap<object, ColumnSpec>();

/** The spec of a framework column builder, or undefined for anything else. */
export function columnSpec(value: unknown): ColumnSpec | undefined {
  return typeof value === "object" && value !== null ? specs.get(value) : undefined;
}

function idOption(option: string): never {
  throw new FrameworkError(
    "CORE.MISCONFIGURED",
    `id() takes no .${option}(): it is the table's primary key (NOT NULL, unique, set from newId())`,
  );
}

function builder<T, N extends boolean = false, D extends boolean = false>(spec: ColumnSpec): ColumnBuilder<T, N, D> {
  const b = {
    nullable: () => (spec.kind === "id" ? idOption("nullable") : builder({ ...spec, nullable: true })),
    unique: () => (spec.kind === "id" ? idOption("unique") : builder({ ...spec, unique: true })),
    default: (value: unknown) => {
      if (spec.kind === "id") idOption("default");
      const checked = checkValue(spec.kind, value, `default value of a ${spec.kind}() column`);
      return builder({ ...spec, hasDefault: true, defaultValue: checked });
    },
  };
  specs.set(b, spec);
  // `_` is type-level only (sql.d.ts); the object has the three option methods.
  return b as unknown as ColumnBuilder<T, N, D>;
}

function plain(kind: ColumnKind): ColumnSpec {
  return { kind, nullable: false, unique: false, hasDefault: false };
}

/** Text primary key holding a framework-generated ID (see newId). Immutable. */
export function id(): ColumnBuilder<string> {
  return builder(plain("id"));
}
/** Text compared by binary (code point) order. */
export function text(): ColumnBuilder<string> {
  return builder(plain("text"));
}
/** Signed 32-bit integer. */
export function integer(): ColumnBuilder<number> {
  return builder(plain("integer"));
}
/** Finite double-precision number. */
export function number(): ColumnBuilder<number> {
  return builder(plain("number"));
}
/** Epoch milliseconds, non-negative safe integer. */
export function timestamp(): ColumnBuilder<number> {
  return builder(plain("timestamp"));
}
export function boolean(): ColumnBuilder<boolean> {
  return builder(plain("boolean"));
}
/** Reference to another table's id column. Deleting a referenced row fails while references exist. */
export function ref(target: () => Column<string, false>): ColumnBuilder<string> {
  // sql.d.ts has no second parameter; one passed by untyped code is recorded, not ignored.
  if (arguments.length > 1) return builder({ ...plain("ref"), target, extraRefArguments: true });
  return builder({ ...plain("ref"), target });
}
