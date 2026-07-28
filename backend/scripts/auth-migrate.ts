// Creates/updates BetterAuth's own tables (user, session, account, verification)
// using BetterAuth's programmatic migrator — same logic as `better-auth migrate`
// but without the CLI's native better-sqlite3 dependency. In 1.6.x getMigrations is
// not re-exported from a public subpath, so we resolve the package and import the
// migrator file directly. Idempotent; runs on boot.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { auth } from "../src/auth";
import { pool } from "../src/db";

const require = createRequire(import.meta.url);

interface Migrations {
  runMigrations: () => Promise<void>;
  toBeCreated: Array<{ table: string }>;
  toBeAdded: Array<{ table: string }>;
}

async function main() {
  const pkgJson = require.resolve("better-auth/package.json");
  const migrator = await import(join(dirname(pkgJson), "dist/db/get-migration.mjs"));
  const getMigrations = migrator.getMigrations as (opts: unknown) => Promise<Migrations>;

  const options = (auth as unknown as { options: unknown }).options;
  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(options);
  console.log(
    `[auth-migrate] create: ${(toBeCreated ?? []).map((t) => t.table).join(", ") || "none"} | ` +
      `alter: ${(toBeAdded ?? []).map((t) => t.table).join(", ") || "none"}`,
  );
  await runMigrations();
  console.log("[auth-migrate] done");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
