import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set — it is composed in docker-compose.yml from the POSTGRES_* vars.",
  );
}

// One shared pool for the process. The realtime service writes ONLY live_* tables
// (schema owned by backend/migrations/); it never touches calls/analyses.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// An idle client erroring (DB restart, connection killed server-side) emits 'error' on
// the pool; with no listener Node treats it as unhandled and crashes the whole process,
// unrelated to any in-flight query. Log it and let the pool recycle the connection.
pool.on("error", (err) => console.error("[realtime] idle pg client error", err));
