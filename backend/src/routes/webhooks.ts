import { Router } from "express";
import { pool } from "../db";
import { asyncHandler } from "../lib/async";
import { rateLimit } from "../middleware/rate-limit";
import { receiveWebhook, processCall } from "../services/ingest";

const router = Router();

// This is the only unauthenticated, publicly reachable route — throttle per client IP
// (real client IP via X-Forwarded-For when `trust proxy` is on behind Caddy). A legit
// Fathom webhook fires once per completed call, so 120/min is generous while still
// blunting floods and token-guessing.
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 120 });

// Fathom posts here when a recording completes. :tenantToken identifies the tenant.
router.post(
  "/fathom/:tenantToken",
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const result = await receiveWebhook(pool, req.params.tenantToken, req.body);
    // Process in the background so the webhook returns fast (Fathom wants a quick 2xx).
    if (result.process) {
      setImmediate(() => {
        processCall(pool, result.callId).catch(() => {
          /* status set to 'failed' inside processCall */
        });
      });
    }
    res
      .status(202)
      .json({ ok: true, call_id: result.callId, status: result.status, duplicate: result.duplicate });
  }),
);

export default router;
