import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../lib/async";
import { leaderboard, repTrends } from "../services/reports";

const router = Router();
router.use(requireAuth);

const isManager = (role: string) => role === "owner" || role === "admin";

// GET /api/leaderboard — per-rep averages (managers only).
router.get(
  "/leaderboard",
  asyncHandler(async (req, res) => {
    const { tenantId, role } = req.auth!;
    if (!isManager(role)) return res.status(403).json({ error: "managers only" });
    res.json(await leaderboard(pool, tenantId));
  }),
);

// GET /api/reps/:id/trends — one rep's trend; members may only view their own.
router.get(
  "/reps/:id/trends",
  asyncHandler(async (req, res) => {
    const { tenantId, role, email } = req.auth!;
    const id = z.string().uuid().parse(req.params.id);
    const out = await repTrends(pool, tenantId, id, isManager(role) ? undefined : email);
    if (!out) return res.status(404).json({ error: "not found" });
    res.json(out);
  }),
);

export default router;
