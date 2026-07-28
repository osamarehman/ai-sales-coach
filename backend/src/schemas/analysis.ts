import { z } from "zod";

// The 11 criteria, in the fixed order the grader prompt emits them. The snake_case
// `key` is the stable identifier used across the API, DB, and Slack rendering; the
// `label` is the human name the model returns in `criterion`.
export const CRITERIA = [
  { key: "call_opening", label: "Call Opening" },
  { key: "question_quality_quantity", label: "Question Quality/Quantity" },
  { key: "tension_building", label: "Tension-Building" },
  { key: "h_high_priority", label: "H - High Priority" },
  { key: "e_economic_resources", label: "E - Economic Resources" },
  { key: "a_authority_to_decide", label: "A - Authority to Decide" },
  { key: "r_readiness_to_act", label: "R - Readiness to Act" },
  { key: "t_temperament", label: "T - Temperament" },
  { key: "objection_prevention_handling", label: "Objection Prevention/Handling" },
  { key: "closing_actions", label: "Closing Actions" },
  { key: "next_steps_follow_up", label: "Next Steps/Follow-Up Approaches" },
] as const;

export const CRITERION_COUNT = CRITERIA.length; // 11

const timestampEvent = z
  .object({
    timestamp: z.string().optional(),
    speaker: z.string().optional(),
    quote: z.string().optional(),
    impact: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough();

// One criterion evaluation. We require the four fields the n8n validator required
// (criterion/rating/score/reasoning) and keep timestamp_events best-effort so a
// slightly-varied-but-good model response is not rejected.
export const evaluationSchema = z
  .object({
    criterion: z.string().min(1),
    rating: z.string().min(1),
    score: z.number(),
    reasoning: z.string().min(1),
    timestamp_events: z.array(timestampEvent).default([]),
  })
  .passthrough();

export const analysisSchema = z
  .object({
    call_metadata: z.object({}).passthrough(),
    evaluations: z.array(evaluationSchema).length(CRITERION_COUNT),
    summary: z
      .object({
        overall_assessment: z.string().optional(),
        total_score: z.number().optional(),
        percentage: z.number().optional(),
        max_possible: z.number().optional(),
      })
      .passthrough(),
    disqualification_summary: z
      .object({ was_disqualified: z.boolean().optional() })
      .passthrough()
      .optional(),
    timestamp_analysis: z.object({}).passthrough().optional(),
    critical_moments: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough();

export type Analysis = z.infer<typeof analysisSchema>;

// Denormalized metrics we persist for fast dashboard queries.
export function deriveMetrics(a: Analysis) {
  const total = a.evaluations.reduce(
    (sum, e) => sum + (Number.isFinite(e.score) ? e.score : 0),
    0,
  );
  const total_score = Math.round(total * 100) / 100;
  const was_disqualified = a.disqualification_summary?.was_disqualified === true;
  return {
    total_score,
    percentage: a.summary?.percentage ?? total_score,
    was_disqualified,
    // The current prompt does not emit a structured won/lost, only free-text in
    // overall_assessment. We persist the machine-derivable outcome; a structured
    // won/lost is an M8 prompt enhancement.
    outcome: was_disqualified ? "disqualified" : "qualified",
  };
}

// Map the ordered evaluations onto their stable snake_case keys for the API/Slack.
export function toCriterionMap(a: Analysis) {
  return a.evaluations.map((e, i) => ({
    key: CRITERIA[i]?.key ?? `criterion_${i + 1}`,
    label: CRITERIA[i]?.label ?? e.criterion,
    criterion: e.criterion,
    rating: e.rating,
    score: e.score,
    reasoning: e.reasoning,
    timestamp_events: e.timestamp_events ?? [],
  }));
}
