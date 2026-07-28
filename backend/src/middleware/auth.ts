import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";
import { pool } from "../db";

// Verify the session server-side (never trust the client) and attach the user's
// tenant. Fail closed: 401 without a valid session, 403 without a tenant.
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ error: "unauthorized" });

    const m = await pool.query<{ tenant_id: string; role: string }>(
      "select tenant_id, role from memberships where user_id = $1 order by created_at asc limit 1",
      [session.user.id],
    );
    if (m.rows.length === 0) return res.status(403).json({ error: "no tenant" });

    req.auth = {
      userId: session.user.id,
      email: session.user.email,
      tenantId: m.rows[0].tenant_id,
      role: m.rows[0].role,
    };
    next();
  } catch (err) {
    next(err);
  }
};
