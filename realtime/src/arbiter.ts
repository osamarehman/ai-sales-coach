// The arbiter (RT-3): the alert-fatigue gate. A PURE function that takes the engine's
// candidate cues plus the current gate state and returns at most ONE cue to surface
// (one-cue-on-screen) plus the next gate state. All timing is on the CALL CLOCK (nowMs,
// ms since session start) so replay tests are deterministic. Policy comes from the
// framework's gating_config; this file just enforces it.
import { z } from "zod";
import type { CueDefinition } from "./framework";
import type { CueTier } from "./protocol";
import type { CueCandidate } from "./cue-engine";

// ---- gating config (parsed defensively from framework.gatingConfig jsonb) --

const DEFAULT_CONFIDENCE = { critical: 0.75, helpful: 0.8, fyi: 0.85 } as const;

// Each field `.catch(undefined)`s independently: one bad value (a fat-fingered `budget_per_30min`)
// falls back to its own default instead of failing the whole parse and silently reverting EVERY
// other tuned setting (warmup, min-gap, thresholds) to defaults.
const GatingSchema = z
  .object({
    confidence_min: z.object({ critical: z.number(), helpful: z.number(), fyi: z.number() }).partial().optional().catch(undefined),
    display_seconds: z.array(z.number()).optional().catch(undefined),
    hard_cap_per_min: z.number().optional().catch(undefined),
    budget_per_30min: z.array(z.number()).optional().catch(undefined),
    min_gap_seconds: z.number().optional().catch(undefined),
    warmup_seconds: z.number().optional().catch(undefined),
    critical_preempts: z.boolean().optional().catch(undefined),
    end_reserve_next_step: z.boolean().optional().catch(undefined),
  })
  .passthrough();

export interface Gating {
  confidenceMin: { critical: number; helpful: number; fyi: number };
  displayMs: number; // overlay auto-dismiss (from display_seconds upper bound)
  hardCapPerMin: number; // absolute ceiling of cues in any 60s
  budgetPer30Min: number; // absolute ceiling of cues in any 30 min (upper bound of the range)
  minGapMs: number; // quiet gap required between cues
  warmupMs: number; // no cues at all before this
  criticalPreempts: boolean; // a critical cue may bypass the min-gap
  endReserveNextStep: boolean; // a critical next-step cue in the closing window bypasses the rate caps
}

export function parseGating(raw: unknown): Gating {
  const parsed = GatingSchema.safeParse(raw ?? {});
  const v = parsed.success ? parsed.data : {};
  const cm = v.confidence_min ?? {};
  const lastOf = (a: number[] | undefined, fallback: number) => (a && a.length ? a[a.length - 1] : fallback);
  return {
    confidenceMin: {
      critical: cm.critical ?? DEFAULT_CONFIDENCE.critical,
      helpful: cm.helpful ?? DEFAULT_CONFIDENCE.helpful,
      fyi: cm.fyi ?? DEFAULT_CONFIDENCE.fyi,
    },
    displayMs: Math.round(lastOf(v.display_seconds, 8) * 1000),
    hardCapPerMin: v.hard_cap_per_min ?? 2,
    budgetPer30Min: lastOf(v.budget_per_30min, 12),
    minGapMs: Math.round((v.min_gap_seconds ?? 20) * 1000),
    warmupMs: Math.round((v.warmup_seconds ?? 75) * 1000),
    criticalPreempts: v.critical_preempts ?? true,
    endReserveNextStep: v.end_reserve_next_step ?? false,
  };
}

// The closing window: the final 5 minutes of the scheduled call, where the "confirm the next
// step" cue is protected from the rate caps. Unknown scheduled length => no reserve (fail-safe).
const CLOSING_WINDOW_MS = 5 * 60_000;
function inClosingWindow(nowMs: number, scheduledLengthMin?: number): boolean {
  if (scheduledLengthMin === undefined) return false;
  return nowMs >= scheduledLengthMin * 60_000 - CLOSING_WINDOW_MS;
}

// ---- priority / tier ------------------------------------------------------

export type Priority = "critical" | "helpful" | "fyi";
const PRIORITY_RANK: Record<string, number> = { critical: 0, helpful: 1, fyi: 2 };
const TIER: Record<Priority, CueTier> = { critical: "crit", helpful: "help", fyi: "fyi" };
const normPriority = (p: string): Priority => (p in PRIORITY_RANK ? (p as Priority) : "fyi");

// ---- emitted cue + gate state ---------------------------------------------

export interface EmittedCue {
  cueKey: string;
  tier: CueTier;
  text: string; // the authored cue_text
  category: string | null;
  confidence: number;
  reason: string | null;
  stage: string | null;
  ttlMs: number;
  tsMs: number; // call-clock ms when it fired
}

export interface GateState {
  emitted: Array<{ cueKey: string; atMs: number; priority: Priority }>;
}
export function initGate(): GateState {
  return { emitted: [] };
}

// One tick's gate decision. Pure: (candidates, ctx) -> { at most one cue, next gate }.
export function arbitrate(
  candidates: CueCandidate[],
  ctx: {
    nowMs: number;
    stage: string | null;
    cuesByKey: Map<string, CueDefinition>;
    gating: Gating;
    gate: GateState;
    scheduledLengthMin?: number; // enables end_reserve_next_step (the closing next-step reminder)
  },
): { emit: EmittedCue | null; gate: GateState } {
  const { nowMs, gating, gate } = ctx;

  // 1) Warm-up: nothing fires in the opening window (early call is noisy + low-signal).
  if (nowMs < gating.warmupMs) return { emit: null, gate };

  // Roll up recent-emit stats once.
  const perCueLast = new Map<string, number>();
  let lastEmitAtMs = -Infinity;
  let countLastMin = 0;
  let countLast30 = 0;
  for (const e of gate.emitted) {
    const prev = perCueLast.get(e.cueKey);
    if (prev === undefined || e.atMs > prev) perCueLast.set(e.cueKey, e.atMs);
    if (e.atMs > lastEmitAtMs) lastEmitAtMs = e.atMs;
    if (nowMs - e.atMs < 60_000) countLastMin++;
    if (nowMs - e.atMs < 30 * 60_000) countLast30++;
  }

  // 2) Filter: known cue, confidence clears its tier threshold, not inside its cooldown.
  const survivors = candidates
    .map((c) => ({ c, def: ctx.cuesByKey.get(c.cueKey) }))
    .filter((x): x is { c: CueCandidate; def: CueDefinition } => !!x.def)
    .filter(({ c, def }) => {
      if (!Number.isFinite(c.confidence)) return false; // NaN passes `<`, Infinity clears any bar — guard the pure fn
      const pr = normPriority(def.priority);
      const threshold = def.confidenceMin ?? gating.confidenceMin[pr];
      if (c.confidence < threshold) return false;
      const cooldownMs = (def.cooldownS ?? 120) * 1000; // per-cue cooldown (default 120s)
      const last = perCueLast.get(c.cueKey);
      if (last !== undefined && nowMs - last < cooldownMs) return false;
      return true;
    });
  if (survivors.length === 0) return { emit: null, gate };

  // 3) Pick the best surviving candidate: highest priority, then highest confidence.
  survivors.sort((a, b) => {
    const pa = PRIORITY_RANK[a.def.priority] ?? 3;
    const pb = PRIORITY_RANK[b.def.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (b.c.confidence !== a.c.confidence) return b.c.confidence - a.c.confidence;
    return a.def.cueKey.localeCompare(b.def.cueKey); // stable final tiebreak
  });
  const best = survivors[0];
  const bestPriority = normPriority(best.def.priority);
  const isCritical = bestPriority === "critical";

  // 4) Spacing gates. Hard caps apply to everyone; a critical cue may pre-empt the min-gap.
  //    Exception (end_reserve_next_step): never let the closing "confirm the next step" cue be
  //    starved by the rate caps — a critical next-step cue in the final window bypasses the
  //    per-min + 30-min budgets (its own per-cue cooldown still prevents repeats). Keyed on
  //    category === "next_step", so it protects BOTH the confirm_next_steps goal (fires once) and
  //    the missing_next_step signal cue (may re-fire on its cooldown — intended: keep nudging the close).
  const reservedNextStep =
    gating.endReserveNextStep &&
    isCritical &&
    best.def.category === "next_step" &&
    inClosingWindow(nowMs, ctx.scheduledLengthMin);
  if (!reservedNextStep) {
    if (countLast30 >= gating.budgetPer30Min) return { emit: null, gate };
    if (countLastMin >= gating.hardCapPerMin) return { emit: null, gate };
  }
  if (nowMs - lastEmitAtMs < gating.minGapMs && !(isCritical && gating.criticalPreempts)) {
    return { emit: null, gate };
  }

  // 5) Emit exactly one cue (one-cue-on-screen) and record it.
  const emit: EmittedCue = {
    cueKey: best.def.cueKey,
    tier: TIER[bestPriority],
    text: best.def.cueText,
    category: best.def.category,
    confidence: best.c.confidence,
    reason: best.c.reason,
    stage: ctx.stage,
    ttlMs: gating.displayMs,
    tsMs: nowMs,
  };
  return {
    emit,
    gate: { emitted: [...gate.emitted, { cueKey: emit.cueKey, atMs: nowMs, priority: bestPriority }] },
  };
}
