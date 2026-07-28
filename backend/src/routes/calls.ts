import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../lib/async";
import { listCalls, getCallScorecard } from "../services/reports";

const router = Router();
router.use(requireAuth);

const isManager = (role: string) => role === "owner" || role === "admin";

const ListQuery = z.object({
  rep: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
  outcome: z.string().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

// GET /api/calls — tenant-scoped list; members see only their own calls.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tenantId, role, email } = req.auth!;
    const q = ListQuery.parse(req.query);
    res.json(
      await listCalls(pool, tenantId, {
        repId: q.rep,
        status: q.status,
        outcome: q.outcome,
        from: q.from,
        to: q.to,
        page: q.page,
        pageSize: q.page_size,
        restrictRepEmail: isManager(role) ? undefined : email,
      }),
    );
  }),
);

// GET /api/calls/:id — full scorecard.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { tenantId, role, email } = req.auth!;
    const id = z.string().uuid().parse(req.params.id);
    const out = await getCallScorecard(pool, tenantId, id, isManager(role) ? undefined : email);
    if (!out) return res.status(404).json({ error: "not found" });
    res.json(out);
  }),
);

export default router;
