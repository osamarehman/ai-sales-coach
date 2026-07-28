import { Router } from "express";
import { pool } from "../db";
import { asyncHandler } from "../lib/async";
import { rateLimit } from "../middleware/rate-limit";
import { WaitlistSignup } from "../schemas/waitlist";

const router = Router();

// Public, unauthenticated form endpoint (the only other one besides the Fathom webhook).
// A real signup is a single POST, so 10/min/IP stops flooding without ever bothering a human.
const waitlistLimiter = rateLimit({ windowMs: 60_000, max: 10 });

router.post(
  "/",
  waitlistLimiter,
  asyncHandler(async (req, res) => {
    const input = WaitlistSignup.parse(req.body ?? {});
    // Dedupe on email; never reveal whether the address was already on the list.
    await pool.query(
      `insert into waitlist (email, source)
       values ($1, $2)
       on conflict (email) do nothing`,
      [input.email, input.source ?? "landing"],
    );
    res.status(201).json({ ok: true });
  }),
);

export default router;
