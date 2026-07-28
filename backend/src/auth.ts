import { betterAuth } from "better-auth";
import { pool } from "./db";
import { config } from "./config";
import { provisionTenantForUser } from "./services/provisioning";

// BetterAuth owns identity: users, sessions, accounts live in its own Postgres
// tables. The app trusts BetterAuth, never the client. Sessions are httpOnly cookies
// verified server-side (see middleware/auth.ts).
export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: config.appUrl,
  basePath: "/api/auth",
  emailAndPassword: { enabled: true, autoSignIn: true },
  trustedOrigins: config.trustedOrigins,
  // Blunt credential stuffing / signup abuse. BetterAuth throttles per IP+path;
  // stricter built-in limits apply to sign-in / reset. On here in every env (not just
  // production) so dev exercises the same path. In-memory store = fine for one instance.
  rateLimit: { enabled: true, window: 60, max: 100 },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Every new signup gets its own tenant (multi-tenant SaaS).
          await provisionTenantForUser(user.id, user.name || user.email);
        },
      },
    },
  },
});
