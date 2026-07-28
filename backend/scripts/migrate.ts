// Applies pending SQL migrations from backend/migrations/ in filename order,
// each in its own transaction, tracked in schema_migrations. Idempotent:
// re-running applies nothing new. Runs on every backend boot (see package.json).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows } = await pool.query<{ version: string }>(
    "select version from schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.version));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [file]);
      await client.query("commit");
      console.log(`[migrate] applied ${file}`);
      count++;
    } catch (err) {
      await client.query("rollback");
      console.error(`[migrate] FAILED ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(count ? `[migrate] ${count} migration(s) applied` : "[migrate] up to date");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
