import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analysisSchema, deriveMetrics, toCriterionMap, CRITERION_COUNT } from "./analysis";

const here = dirname(fileURLToPath(import.meta.url));
const good = JSON.parse(
  readFileSync(join(here, "../../fixtures/sample-analysis.json"), "utf8"),
) as Record<string, unknown> & { evaluations: unknown[] };

describe("analysisSchema", () => {
  it("accepts a valid 11-criteria analysis", () => {
    const a = analysisSchema.parse(good);
    expect(a.evaluations).toHaveLength(CRITERION_COUNT);
  });

  it("rejects when there are not exactly 11 evaluations", () => {
    const bad = { ...good, evaluations: good.evaluations.slice(0, 10) };
    expect(() => analysisSchema.parse(bad)).toThrow();
  });

  it("rejects an evaluation missing reasoning", () => {
    const evals = good.evaluations.map((e, i) =>
      i === 0 ? { ...(e as object), reasoning: undefined } : e,
    );
    expect(() => analysisSchema.parse({ ...good, evaluations: evals })).toThrow();
  });
});

describe("deriveMetrics / toCriterionMap", () => {
  it("derives total score and outcome", () => {
    const m = deriveMetrics(analysisSchema.parse(good));
    expect(m.total_score).toBeCloseTo(90.91, 2);
    expect(m.was_disqualified).toBe(false);
    expect(m.outcome).toBe("qualified");
  });

  it("maps ordered evaluations onto stable keys", () => {
    const map = toCriterionMap(analysisSchema.parse(good));
    expect(map).toHaveLength(11);
    expect(map[0].key).toBe("call_opening");
    expect(map[3].key).toBe("h_high_priority");
    expect(map[10].key).toBe("next_steps_follow_up");
  });
});
