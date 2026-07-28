import { config, requireTokenSecret } from "./config";
import { startServer } from "./server";
import { captureException, flushTelemetry } from "./lib/telemetry";

// Catch errors that escape the WS handlers (timers, async cue work) so they still reach PostHog.
// A rejection is logged + captured but not fatal; an uncaught exception is unsafe to resume, so we
// flush and exit for the container to restart.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
  captureException(reason, { kind: "unhandledRejection" });
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
  captureException(err, { kind: "uncaughtException" });
  void flushTelemetry().finally(() => process.exit(1));
});
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void flushTelemetry().finally(() => process.exit(0)));
}

// Fail fast at boot: no signing secret => cannot verify any client. Importing ./server
// pulls in ./db, which throws if DATABASE_URL is missing — both are hard requirements.
requireTokenSecret();
startServer(config.port);
