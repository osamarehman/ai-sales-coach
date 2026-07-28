import { randomBytes } from "node:crypto";
import { pool } from "../db";

// Display name -> url-ish slug with a short random suffix for uniqueness.
function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

// Runs once per new signup (BetterAuth user.create.after hook): create the user's
// tenant, an owner membership, and a copy of the default H.E.A.R.T. rubric so
// analyses work out of the box. Transactional.
export async function provisionTenantForUser(userId: string, displayName: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const tenant = await client.query<{ id: string }>(
      "insert into tenants (name, slug, webhook_token) values ($1, $2, $3) returning id",
      [`${displayName}'s Workspace`, slugify(displayName), randomBytes(24).toString("hex")],
    );
    const tenantId = tenant.rows[0].id;

    await client.query(
      `insert into memberships (user_id, tenant_id, role) values ($1, $2, 'owner')
       on conflict (user_id, tenant_id) do nothing`,
      [userId, tenantId],
    );

    // Copy the default tenant's active rubric into the new tenant.
    await client.query(
      `insert into rubrics (tenant_id, version, name, system_prompt, is_active)
       select $1, 1, name, system_prompt, true
         from rubrics
        where tenant_id = (select id from tenants where slug = 'default') and is_active
        order by version desc
        limit 1`,
      [tenantId],
    );

    await client.query("commit");
    return tenantId;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
