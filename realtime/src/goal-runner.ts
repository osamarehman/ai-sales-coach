// The scheduled-goal runner (RT-4): the second cue source alongside the signal-driven
// cue-engine. Goals are small FIRE-ONCE state machines (deadline / guard / watch / window)
// that track call COVERAGE — which sales stages the rep has actually engaged, plus a couple
// of prospect signals — and nudge when a stage is being skipped or a deadline is slipping.
//
// Split of responsibility (mirrors signals / arbiter — pure mechanics, no DB, no req/res):
//   - the cue-engine (LLM) OBSERVES coverage per window (stages engaged, is-presenting, ...).
//   - THIS runner folds those observations into cumulative call state and evaluates each
//     goal's arm/condition/satisfied predicate deterministically on the CALL CLOCK.
//   - the cue-runtime owns the fire-once memory (a goal counts as "fired" only once the
//     ARBITER actually emits it) and merges goal candidates into the same arbiter as signal
//     cues, so alert-fatigue gating (one-cue-on-screen, min-gap, budgets) applies uniformly.
//
// The rep-facing text is always the goal's authored cue_text — no LLM free-text — so it's
// de-brand-safe, exactly like the signal cues. Predicates are DATA-DRIVEN from each goal's
// `config` (deadline_sec / arm_when / require_uncovered / watch / ...), so the runner stays
// generic across frameworks instead of hard-coding the eight default goals.
import { z } from "zod";
import type { CueDefinition, CueGoal } from "./framework";
import type { CoverageObservation, CueCandidate } from "./cue-engine";

// ---- cumulative coverage state --------------------------------------------

// Folded forward from each tick's per-window observation. Monotonic on purpose: the LLM
// only sees a rolling window, so "did the rep EVER ask a problem-awareness question" has to
// accumulate here — once a stage is seen covered it stays covered for the rest of the call.
export interface CoverageState {
  coveredStages: Set<string>;
  budgetMentioned: boolean;
  incumbentNamed: boolean;
}

export function initCoverage(): CoverageState {
  return { coveredStages: new Set(), budgetMentioned: false, incumbentNamed: false };
}

export function mergeCoverage(state: CoverageState, obs: CoverageObservation): CoverageState {
  const coveredStages = new Set(state.coveredStages);
  for (const s of obs.stagesCovered) coveredStages.add(s);
  if (obs.isPresenting) coveredStages.add("present"); // "presenting now" == having reached present
  return {
    coveredStages,
    budgetMentioned: state.budgetMentioned || obs.prospectMentionedBudget,
    incumbentNamed: state.incumbentNamed || obs.prospectNamedIncumbent,
  };
}

// ---- goal config (the machine-readable predicate vocabulary) --------------

const GoalConfig = z
  .object({
    deadline_sec: z.number().optional(), // deadline: fire once the call clock passes this
    window_end_sec: z.number().optional(), // guard: only fires before this call-clock second
    window_last_sec: z.number().optional(), // window: fires in the final N sec of scheduled length
    arm_when: z.string().optional(), // guard trigger, e.g. "stage_covered:present" | "stage_covered:transition|commit"
    require_uncovered: z.string().optional(), // fires while this stage is UNcovered; covered => satisfied (cancels)
    require_covered: z.string().optional(), // precondition: this stage must already be covered
    watch: z.enum(["budget", "incumbent"]).optional(), // watch: fire on a prospect signal
    category: z.string().optional(), // cue category surfaced to the client (defaults to "sequence")
  })
  .passthrough();

function goalConfig(g: CueGoal): z.infer<typeof GoalConfig> {
  const parsed = GoalConfig.safeParse(g.config ?? {});
  return parsed.success ? parsed.data : {};
}

// ---- arbiter interop ------------------------------------------------------

// Present each goal to the arbiter as if it were a cue definition, so goal candidates run
// through the very same alert-fatigue gate as signal cues (one-cue-on-screen, min-gap,
// budgets, priority ranking) with no special-casing in the arbiter.
export function goalDefs(goals: CueGoal[]): CueDefinition[] {
  return goals.map((g) => ({
    cueKey: g.goalKey,
    name: g.label,
    category: goalConfig(g).category ?? "sequence",
    stage: null,
    triggerSignal: g.label,
    cueText: g.cueText,
    priority: g.priority,
    confidenceMin: 0, // a fired goal is deterministic, not a probability — it always clears the bar
    cooldownS: null,
  }));
}

// ---- evaluation -----------------------------------------------------------

export interface GoalContext {
  nowMs: number; // call clock
  scheduledLengthMin?: number; // needed only by `window` goals (the closing next-step reminder)
  coverage: CoverageState;
  firedGoalKeys: ReadonlySet<string>; // goals the arbiter has already surfaced this call
}

// Which goals want to fire this tick. Each returns a certain (confidence 1) candidate; the
// arbiter still decides whether it actually surfaces (and only then does it count as fired).
export function evaluateGoals(goals: CueGoal[], ctx: GoalContext): CueCandidate[] {
  const out: CueCandidate[] = [];
  for (const g of goals) {
    if (ctx.firedGoalKeys.has(g.goalKey)) continue; // fire-once
    if (goalFires(g, ctx)) out.push({ cueKey: g.goalKey, confidence: 1, reason: g.label });
  }
  return out;
}

function goalFires(g: CueGoal, ctx: GoalContext): boolean {
  const cfg = goalConfig(g);
  const sec = ctx.nowMs / 1000;
  const covered = (slug?: string): boolean => !!slug && ctx.coverage.coveredStages.has(slug);

  // Precondition, and the "satisfied_by" cancel: if the target stage is now covered the goal
  // was met and never fires. (`require_uncovered` doubles as the satisfied predicate.)
  if (cfg.require_covered && !covered(cfg.require_covered)) return false;
  if (cfg.require_uncovered && covered(cfg.require_uncovered)) return false;

  switch (g.type) {
    case "deadline":
      // Crossed the deadline with the target stage still uncovered.
      return cfg.deadline_sec !== undefined && sec >= cfg.deadline_sec && cfg.require_uncovered !== undefined;
    case "guard": {
      // Armed by a later-stage question being issued; optionally only within an early window.
      if (!armStageSatisfied(cfg.arm_when, ctx.coverage)) return false;
      if (cfg.window_end_sec !== undefined && sec > cfg.window_end_sec) return false;
      return cfg.require_uncovered !== undefined;
    }
    case "watch":
      return cfg.watch === "budget"
        ? ctx.coverage.budgetMentioned
        : cfg.watch === "incumbent"
          ? ctx.coverage.incumbentNamed
          : false;
    case "window": {
      // The closing window: the final N seconds of the scheduled call length.
      if (ctx.scheduledLengthMin === undefined || cfg.window_last_sec === undefined) return false;
      const startSec = ctx.scheduledLengthMin * 60 - cfg.window_last_sec;
      return sec >= startSec && cfg.require_uncovered !== undefined;
    }
    default:
      return false;
  }
}

// "stage_covered:present" | "stage_covered:transition|commit" -> true if ANY listed stage is covered.
function armStageSatisfied(armWhen: string | undefined, coverage: CoverageState): boolean {
  if (!armWhen) return false;
  const m = /^stage_covered:(.+)$/.exec(armWhen);
  if (!m) return false;
  return m[1].split("|").some((slug) => coverage.coveredStages.has(slug.trim()));
}
