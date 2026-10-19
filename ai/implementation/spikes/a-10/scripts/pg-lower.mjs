// Checks whether lower()/upper() fold only ASCII in PGlite (sql.md §2 containsText assumption).
import { PGlite } from "@electric-sql/pglite";

const pg = await PGlite.create();
const q = async (s) => {
  try {
    console.log(s, "=>", JSON.stringify((await pg.query(s)).rows));
  } catch (e) {
    console.log(s, "=> ERROR", e.message);
  }
};
await q(`show lc_collate`);
await q(`show lc_ctype`);
await q(`show server_encoding`);
await q(`select lower('ÀB') as l, lower('ÀB' collate "C") as lc, upper('àb' collate "C") as uc`);
await q(`select 'é' < 'z' as cmp_default, ('é' collate "C") < 'z' as cmp_c`);
await q(`CREATE DATABASE spikec TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
await q(`select datname, datcollate, datctype from pg_database where datname = 'spikec'`);
await pg.close();

// Can a PGlite instance open the C/C database? (file-backed, two instances)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "pglite-a10-"));
const a = await PGlite.create(dir);
await a.query(`CREATE DATABASE appdb TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
await a.close();
const b = await PGlite.create(dir, { database: "appdb" });
console.log("appdb:", JSON.stringify((await b.query(`select current_database() as db, lower('ÀB') as l, 'é' < 'z' as cmp`)).rows));
await b.close();
rmSync(dir, { recursive: true, force: true });
