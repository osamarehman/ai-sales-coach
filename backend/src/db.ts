import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set — it is composed in docker-compose.yml from the POSTGRES_* vars.",
  );
}

// One shared pool for the process. The migrate/seed scripts import this too and
// call pool.end() when they finish so the process can exit.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
