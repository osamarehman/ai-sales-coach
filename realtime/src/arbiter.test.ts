import { describe, expect, test } from "bun:test";
import { arbitrate, initGate, parseGating, type GateState, type Gating } from "./arbiter";
import type { CueDefinition } from "./framework";
import type { CueCandidate } from "./cue-engine";

const cdef = (cueKey: string, priority: string, opts: { cooldownS?: number; confidenceMin?: number } = {}): CueDefinition => ({
  cueKey,
  name: cueKey,
  category: "c",
  stage: null,
  triggerSignal: "t",
  cueText: `do ${cueKey}`,
  priority,
  confidenceMin: opts.confidenceMin ?? null,
  cooldownS: opts.cooldownS ?? null,
});
const cand = (cueKey: string, confidence: number): CueCandidate => ({ cueKey, confidence, reason: null });

const GATING: Gating = {
  confidenceMin: { critical: 0.75, helpful: 0.8, fyi: 0.85 },
  displayMs: 8000,
  hardCapPerMin: 2,
  budgetPer30Min: 12,
  minGapMs: 20000,
  warmupMs: 75000,
  criticalPreempts: true,
  endReserveNextStep: false,
};
const defs = [cdef("t_drift", "fyi", { cooldownS: 180 }), cdef("mono", "critical", { cooldownS: 90 }), cdef("next", "critical")];
const cues = new Map(defs.map((d) => [d.cueKey, d]));
const ctx = (gate: GateState = initGate(), nowMs = 100000) => ({ nowMs, stage: "discover", cuesByKey: cues, gating: GATING, gate });

describe("parseGating", () => {
  test("reads the real gating_config shape", () => {
    const g = parseGating({
      confidence_min: { critical: 0.75, helpful: 0.8, fyi: 0.85 },
      display_seconds: [6, 8],
      budget_per_30min: [8, 12],
      min_gap_seconds: 20,
      warmup_seconds: 75,
      hard_cap_per_min: 2,
      critical_preempts: true,
    });
    expect(g.minGapMs).toBe(20000);
    expect(g.warmupMs).toBe(75000);
    expect(g.displayMs).toBe(8000);
    expect(g.budgetPer30Min).toBe(12);
    expect(g.confidenceMin.critical).toBe(0.75);
  });

  test("fills defaults from a null/garbage config", () => {
    const g = parseGating(null);
    expect(g.warmupMs).toBe(75000);
    expect(g.confidenceMin.fyi).toBe(0.85);
    expect(g.criticalPreempts).toBe(true);
  });
});

describe("arbitrate", () => {
  test("suppresses everything during warm-up", () => {
    expect(arbitrate([cand("mono", 0.99)], ctx(initGate(), 10000)).emit).toBeNull();
  });

  test("drops candidates below the tier confidence threshold", () => {
    expect(arbitrate([cand("t_drift", 0.84)], ctx()).emit).toBeNull(); // fyi needs 0.85
    expect(arbitrate([cand("t_drift", 0.86)], ctx()).emit?.cueKey).toBe("t_drift");
  });

  test("emits one cue — highest priority — with mapped tier and the authored text", () => {
    const r = arbitrate([cand("t_drift", 0.9), cand("mono", 0.8)], ctx());
    expect(r.emit?.cueKey).toBe("mono");
    expect(r.emit?.tier).toBe("crit");
    expect(r.emit?.text).toBe("do mono");
    expect(r.emit?.ttlMs).toBe(8000);
    expect(r.gate.emitted).toHaveLength(1);
  });

  test("enforces min-gap, but a critical cue pre-empts it", () => {
    const gate: GateState = { emitted: [{ cueKey: "t_drift", atMs: 100000, priority: "fyi" }] };
    expect(arbitrate([cand("next", 0.9)], ctx(gate, 110000)).emit?.cueKey).toBe("next"); // critical preempts
    const gate2: GateState = { emitted: [{ cueKey: "mono", atMs: 100000, priority: "critical" }] };
    expect(arbitrate([cand("t_drift", 0.99)], ctx(gate2, 110000)).emit).toBeNull(); // fyi blocked by min-gap
  });

  test("per-cue cooldown blocks a repeat of the same cue even when critical", () => {
    const gate: GateState = { emitted: [{ cueKey: "mono", atMs: 100000, priority: "critical" }] };
    expect(arbitrate([cand("mono", 0.99)], ctx(gate, 130000)).emit).toBeNull(); // 30s < 90s cooldown
  });

  test("budget hard cap blocks further cues in the 30-min window", () => {
    const emitted = Array.from({ length: 12 }, (_, i) => ({ cueKey: "next", atMs: 1000 * i, priority: "critical" as const }));
    expect(arbitrate([cand("next", 0.99)], ctx({ emitted }, 200000)).emit).toBeNull();
  });

  test("ignores unknown cue keys", () => {
    expect(arbitrate([cand("ghost", 0.99)], ctx()).emit).toBeNull();
  });
});

describe("arbitrate — end_reserve_next_step", () => {
  const nextStepDef: CueDefinition = { ...cdef("wrap", "critical"), category: "next_step" };
  const nsCues = new Map<string, CueDefinition>([[nextStepDef.cueKey, nextStepDef]]);
  // A 30-min window that's already at its budget cap (12 cues), none within the last minute.
  const budgetFull = (): GateState => ({
    emitted: Array.from({ length: 12 }, (_, i) => ({ cueKey: "x", atMs: 1000 * i, priority: "critical" as const })),
  });
  const nsCtx = (over: Partial<Parameters<typeof arbitrate>[1]>) => ({
    nowMs: 29 * 60_000, // 29:00
    stage: "commit",
    cuesByKey: nsCues,
    gating: { ...GATING, endReserveNextStep: true },
    gate: budgetFull(),
    scheduledLengthMin: 30, // closing window = 25:00–30:00, so 29:00 is inside it
    ...over,
  });

  test("a critical next-step cue in the closing window bypasses the budget cap", () => {
    expect(arbitrate([cand("wrap", 0.99)], nsCtx({})).emit?.cueKey).toBe("wrap");
  });

  test("the same cue is still capped OUTSIDE the closing window", () => {
    expect(arbitrate([cand("wrap", 0.99)], nsCtx({ nowMs: 10 * 60_000 })).emit).toBeNull();
  });

  test("no bypass when the reserve is disabled", () => {
    expect(arbitrate([cand("wrap", 0.99)], nsCtx({ gating: { ...GATING, endReserveNextStep: false } })).emit).toBeNull();
  });

  test("no bypass without a known scheduled length", () => {
    expect(arbitrate([cand("wrap", 0.99)], nsCtx({ scheduledLengthMin: undefined })).emit).toBeNull();
  });
});
