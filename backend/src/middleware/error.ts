import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { captureException } from "../lib/telemetry";

// Throw this from routes/services to control the HTTP status.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Centralized error handler — mounted last. Never leaks stack traces or SQL to clients.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError)
    return res.status(400).json({ error: "invalid input", details: err.issues });
  // Unexpected (5xx) only — the 4xx branches above are expected/handled and would just be noise.
  // Log locally AND ship to PostHog so error spikes are visible and attributable to a user/tenant.
  console.error(err);
  captureException(err, {
    route: req.originalUrl,
    method: req.method,
    status: 500,
    distinctId: req.auth?.userId,
    tenantId: req.auth?.tenantId,
  });
  res.status(500).json({ error: "internal error" });
};

export const notFound: RequestHandler = (_req, res) => res.status(404).json({ error: "not found" });
