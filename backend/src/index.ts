import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import { pool } from "./db";
import webhooks from "./routes/webhooks";
import waitlist from "./routes/waitlist";
import me from "./routes/me";
import settings from "./routes/settings";
import calls from "./routes/calls";
import analytics from "./routes/analytics";
import realtime from "./routes/realtime";
import { errorHandler, notFound } from "./middleware/error";
import { captureException, flushTelemetry } from "./lib/telemetry";

const app = express();

// Behind the prod TLS reverse proxy (Caddy), trust its X-Forwarded-* headers so
// req.ip is the real client, not the proxy. Off by default (direct-connect dev);
// TRUST_PROXY=1 in docker-compose.prod.yml. Only safe because in prod nothing but
// Caddy can reach the backend (no published host port).
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);

// BetterAuth parses its own request bodies — mount it BEFORE express.json().
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));

// Health: also proves the DB connection works.
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ ok: true, db: "up" });
  } catch {
    res.status(503).json({ ok: false, db: "down" });
  }
});

app.use("/api/webhooks", webhooks);
app.use("/api/waitlist", waitlist); // public: landing-page email capture
app.use("/api/me", me);
app.use("/api/settings", settings);
app.use("/api/calls", calls);
app.use("/api/realtime", realtime); // authed: mints the realtime WS session token
app.use("/api", analytics); // /api/leaderboard, /api/reps/:id/trends

app.use(notFound);
app.use(errorHandler);

// Catch errors that escape Express (async jobs, timers, event handlers) so they still reach PostHog.
// A rejection is logged + captured but not fatal; an uncaught exception leaves the process in an
// unknown state, so we flush and exit for the container to restart cleanly.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
  captureException(reason, { kind: "unhandledRejection" });
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
  captureException(err, { kind: "uncaughtException" });
  void flushTelemetry().finally(() => process.exit(1));
});
// Flush buffered telemetry on graceful shutdown (docker stop / redeploy) so the last errors aren't lost.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void flushTelemetry().finally(() => process.exit(0)));
}

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`backend listening on :${port}`));
