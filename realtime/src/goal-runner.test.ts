import { describe, expect, test } from "bun:test";
import { evaluateGoals, goalDefs, initCoverage, mergeCoverage, type CoverageState } from "./goal-runner";
import type { CueGoal } from "./framework";
import type { CoverageObservation } from "./cue-engine";

const goal = (goalKey: string, type: string, config: unknown, priority = "helpful"): CueGoal => ({
  goalKey,
  label: goalKey,
  type,
  cueText: `do ${goalKey}`,
  priority,
  config,
});
const cov = (stages: string[] = [], extra: { budget?: boolean; incumbent?: boolean } = {}): CoverageState => ({
  coveredStages: new Set(stages),
  budgetMentioned: !!extra.budget,
  incumbentNamed: !!extra.incumbent,
});
const fires = (
  goals: CueGoal[],
  ctx: { nowMs: number; scheduledLengthMin?: number; coverage: CoverageState; firedGoalKeys?: ReadonlySet<string> },
): string[] => evaluateGoals(goals, { ...ctx, firedGoalKeys: ctx.firedGoalKeys ?? new Set() }).map((c) => c.cueKey);

// The eight default goals, expressed exactly as goals.default.json seeds them.
const G = {
  connect: goal("connect_first", "guard", { arm_when: "stage_covered:discover", require_uncovered: "connect", window_end_sec: 120 }),
  pa6: goal("problem_awareness_by_6", "deadline", { deadline_sec: 360, require_uncovered: "frame_problem" }, "critical"),
  consPitch: goal("consequence_before_pitch", "guard", { arm_when: "stage_covered:present", require_uncovered: "consequence" }, "critical"),
  cons8: goal("consequence_by_8", "deadline", { deadline_sec: 480, require_uncovered: "consequence", require_covered: "frame_problem" }),
  budget: goal("budget_watch", "watch", { watch: "budget" }),
  incumbent: goal("incumbent_watch", "watch", { watch: "incumbent" }),
  nextSteps: goal("confirm_next_steps", "window", { window_last_sec: 300, require_uncovered: "commit", category: "next_step" }, "critical"),
  qualify: goal("qualify_before_transition", "guard", { arm_when: "stage_covered:transition|commit", require_uncovered: "qualify" }),
};

describe("evaluateGoals — deadline", () => {
  test("fires only past the deadline, and never once the target stage is covered", () => {
    expect(fires([G.pa6], { nowMs: 300_000, coverage: cov([]) })).toEqual([]); // 5:00, before 6:00
    expect(fires([G.pa6], { nowMs: 360_000, coverage: cov([]) })).toEqual(["problem_awareness_by_6"]); // 6:00, uncovered
    expect(fires([G.pa6], { nowMs: 400_000, coverage: cov(["frame_problem"]) })).toEqual([]); // covered => satisfied
  });

  test("a precondition stage must be covered first", () => {
    // 8:00, consequence uncovered — but frame_problem not covered yet, so the precondition fails.
    expect(fires([G.cons8], { nowMs: 480_000, coverage: cov([]) })).toEqual([]);
    expect(fires([G.cons8], { nowMs: 480_000, coverage: cov(["frame_problem"]) })).toEqual(["consequence_by_8"]);
    expect(fires([G.cons8], { nowMs: 480_000, coverage: cov(["frame_problem", "consequence"]) })).toEqual([]); // satisfied
  });
});

describe("evaluateGoals — guard", () => {
  test("fires once armed by a later stage, unless the target is already covered", () => {
    expect(fires([G.consPitch], { nowMs: 200_000, coverage: cov(["discover"]) })).toEqual([]); // not presenting => not armed
    expect(fires([G.consPitch], { nowMs: 200_000, coverage: cov(["present"]) })).toEqual(["consequence_before_pitch"]);
    expect(fires([G.consPitch], { nowMs: 200_000, coverage: cov(["present", "consequence"]) })).toEqual([]); // satisfied
  });

  test("a time-bounded guard only fires inside its window", () => {
    expect(fires([G.connect], { nowMs: 90_000, coverage: cov(["discover"]) })).toEqual(["connect_first"]); // dove in early
    expect(fires([G.connect], { nowMs: 130_000, coverage: cov(["discover"]) })).toEqual([]); // past 2:00 => closed
    expect(fires([G.connect], { nowMs: 90_000, coverage: cov(["discover", "connect"]) })).toEqual([]); // connected first
  });

  test("arms on ANY of several stages", () => {
    expect(fires([G.qualify], { nowMs: 300_000, coverage: cov(["commit"]) })).toEqual(["qualify_before_transition"]);
    expect(fires([G.qualify], { nowMs: 300_000, coverage: cov(["transition", "qualify"]) })).toEqual([]); // satisfied
    expect(fires([G.qualify], { nowMs: 300_000, coverage: cov(["discover"]) })).toEqual([]); // not armed
  });
});

describe("evaluateGoals — watch", () => {
  test("fires on the prospect signal", () => {
    expect(fires([G.budget, G.incumbent], { nowMs: 100_000, coverage: cov([]) })).toEqual([]);
    expect(fires([G.budget], { nowMs: 100_000, coverage: cov([], { budget: true }) })).toEqual(["budget_watch"]);
    expect(fires([G.incumbent], { nowMs: 100_000, coverage: cov([], { incumbent: true }) })).toEqual(["incumbent_watch"]);
  });
});

describe("evaluateGoals — window", () => {
  test("fires only in the closing stretch, and needs a scheduled length", () => {
    expect(fires([G.nextSteps], { nowMs: 600_000, coverage: cov([]) })).toEqual([]); // no scheduled length
    expect(fires([G.nextSteps], { nowMs: 14 * 60_000, scheduledLengthMin: 20, coverage: cov([]) })).toEqual([]); // 14:00, not yet
    expect(fires([G.nextSteps], { nowMs: 16 * 60_000, scheduledLengthMin: 20, coverage: cov([]) })).toEqual(["confirm_next_steps"]); // last 5 min
    expect(fires([G.nextSteps], { nowMs: 16 * 60_000, scheduledLengthMin: 20, coverage: cov(["commit"]) })).toEqual([]); // committed => satisfied
  });
});

describe("evaluateGoals — fire-once", () => {
  test("a goal already surfaced is not produced again", () => {
    const ctx = { nowMs: 360_000, coverage: cov([]), firedGoalKeys: new Set(["problem_awareness_by_6"]) };
    expect(fires([G.pa6], ctx)).toEqual([]);
  });

  test("produces a certain candidate carrying the goal key as reason", () => {
    const [c] = evaluateGoals([G.pa6], { nowMs: 360_000, coverage: cov([]), firedGoalKeys: new Set() });
    expect(c.cueKey).toBe("problem_awareness_by_6");
    expect(c.confidence).toBe(1);
    expect(c.reason).toBe("problem_awareness_by_6");
  });
});

describe("mergeCoverage", () => {
  const obs = (o: Partial<CoverageObservation>): CoverageObservation => ({
    stagesCovered: [],
    isPresenting: false,
    prospectMentionedBudget: false,
    prospectNamedIncumbent: false,
    ...o,
  });

  test("accumulates monotonically across windows", () => {
    let s = initCoverage();
    s = mergeCoverage(s, obs({ stagesCovered: ["connect", "discover"] }));
    s = mergeCoverage(s, obs({ isPresenting: true, prospectMentionedBudget: true }));
    s = mergeCoverage(s, obs({})); // an empty later window must not erase prior coverage
    expect([...s.coveredStages].sort()).toEqual(["connect", "discover", "present"]); // is_presenting => present
    expect(s.budgetMentioned).toBe(true);
    expect(s.incumbentNamed).toBe(false);
  });
});

describe("goalDefs", () => {
  test("presents a goal to the arbiter as a cue definition", () => {
    const [d] = goalDefs([G.nextSteps]);
    expect(d.cueKey).toBe("confirm_next_steps");
    expect(d.category).toBe("next_step");
    expect(d.cueText).toBe("do confirm_next_steps");
    expect(d.priority).toBe("critical");
    expect(d.confidenceMin).toBe(0); // deterministic => always clears the confidence bar
  });

  test("carries an explicit category, else defaults to 'sequence'", () => {
    const withCat = goal("x", "deadline", { deadline_sec: 1, require_uncovered: "frame_problem", category: "discovery_gap" });
    expect(goalDefs([withCat])[0].category).toBe("discovery_gap");
    expect(goalDefs([goal("y", "guard", {})])[0].category).toBe("sequence");
  });
});
