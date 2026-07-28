import type { RequestHandler } from "express";

// Wrap an async route so thrown errors reach the centralized error handler.
// Express 4 does not catch async throws on its own.
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
