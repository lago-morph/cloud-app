import { and, eq, inArray } from "@lago-morph/prototype-framework";
import type { CaseServices, CaseSet } from "../case-types";
import { children, parents } from "../evolution";

/**
 * Migration case set (C-T2, MIG-AC-003): corrects the data fixture so the `unique-fail`
 * overlay's unique constraint on `children.label` can be applied. The fixture has two
 * children labelled `shared` (parents `alpha` and `beta`); this relabels `beta`'s to
 * `shared-beta`. Uses only columns every version of the fixture has.
 */
const relabelDuplicate = async ({ sql }: CaseServices): Promise<unknown> => {
  const beta = sql.select({ id: parents.id }).from(parents).where(eq(parents.name, "beta"));
  const changed = await sql
    .update(children)
    .set({ label: "shared-beta" })
    .where(and(eq(children.label, "shared"), inArray(children.parentId, beta)))
    .returning({ id: children.id });
  return { changed: changed.length };
};

export const migCases: CaseSet = { relabelDuplicate };
