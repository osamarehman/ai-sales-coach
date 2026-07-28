import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../lib/async";
import { rateLimit } from "../middleware/rate-limit";
import { config, requireRealtimeSecret } from "../config";
import { signRealtimeToken } from "../lib/realtime-token";

// Mints the short-lived token a desktop/phone client redeems to open the realtime
// WebSocket (see the `realtime` service + desktop/PROTOCOL.md). The token carries the
// caller's tenant + user, signed server-side, so the realtime service never trusts the
// client. This is the ONLY bridge between the main API and the isolated realtime lane.
const router = Router();

// One mint per call start — a handful per hour at most. Cap abuse without bothering a human.
const tokenLimiter = rateLimit({ windowMs: 60_000, max: 30 });

router.post(
  "/token",
  tokenLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const secret = requireRealtimeSecret();
    const { tenantId, userId, role } = req.auth!;
    const ttlSeconds = 300; // the client redeems immediately to open the socket
    const token = signRealtimeToken({ tid: tenantId, uid: userId, role }, secret, ttlSeconds);
    res.json({ token, ws_url: config.realtime.wsUrl, expires_in: ttlSeconds });
  }),
);

export default router;
