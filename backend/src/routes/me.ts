import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../lib/async";

const router = Router();

// Who am I + which tenant am I in. Proves session verification + tenant scoping.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, email, role, tenantId } = req.auth!;
    const t = await pool.query<{ id: string; name: string; slug: string }>(
      "select id, name, slug from tenants where id = $1",
      [tenantId],
    );
    res.json({
      user: { id: userId, email, role },
      tenant: t.rows[0],
    });
  }),
);

export default router;
