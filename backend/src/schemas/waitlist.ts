import { z } from "zod";

// Validation for the public waitlist signup (POST /api/waitlist). Kept DB-free (no pool import)
// so it unit-tests without a database, matching the schemas/ convention (see schemas/analysis.ts).
//
// `company` is a honeypot: a hidden field no human fills, so any content = a bot (reject).
// Email is trimmed + lowercased so the unique constraint dedupes case/space variants.
// `source` tags where the signup came from (e.g. 'landing-hero') for later attribution.
export const WaitlistSignup = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  company: z.string().max(0).optional(),
  source: z.string().trim().max(80).optional(),
});

export type WaitlistSignup = z.infer<typeof WaitlistSignup>;
