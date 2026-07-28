import type { Pool } from "pg";
import { config } from "../config";
import { chat } from "./openrouter";
import { parseJsonObject } from "../lib/json";
import { analysisSchema, deriveMetrics, type Analysis } from "../schemas/analysis";

// Injectable LLM caller so the pipeline is unit-testable without a real API key.
export type Completer = (messages: { system: string; user: string }) => Promise<string>;

const defaultCompleter: Completer = ({ system, user }) => chat({ system, user });

export interface RunAnalysisInput {
  systemPrompt: string;
  transcriptText: string;
  complete?: Completer;
  maxAttempts?: number;
}

export interface AnalysisResult {
  analysis: Analysis;
  metrics: ReturnType<typeof deriveMetrics>;
  attempts: number;
  model: string;
}

// LLM -> extract JSON -> validate, retrying on invalid output (ports the n8n
// validate -> retry loop). Throws if every attempt fails validation.
export async function runAnalysis(input: RunAnalysisInput): Promise<AnalysisResult> {
  const complete = input.complete ?? defaultCompleter;
  const maxAttempts = input.maxAttempts ?? 2; // 1 retry, like the original workflow
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await complete({ system: input.systemPrompt, user: input.transcriptText });
    try {
      const analysis = analysisSchema.parse(parseJsonObject(raw));
      return {
        analysis,
        metrics: deriveMetrics(analysis),
        attempts: attempt,
        model: config.openRouter.model,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Analysis failed validation after ${maxAttempts} attempt(s): ${reason}`);
}

// Persist a completed analysis for a call. One analysis per call (upsert on call_id).
export async function persistAnalysis(
  pool: Pool,
  args: {
    tenantId: string;
    callId: string;
    rubricId?: string | null;
    result: AnalysisResult;
  },
): Promise<string> {
  const { tenantId, callId, rubricId, result } = args;
  const { rows } = await pool.query<{ id: string }>(
    `insert into analyses
       (tenant_id, call_id, rubric_id, model, raw_json, total_score, outcome, was_disqualified)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (call_id) do update set
       raw_json = excluded.raw_json,
       model = excluded.model,
       total_score = excluded.total_score,
       outcome = excluded.outcome,
       was_disqualified = excluded.was_disqualified,
       rubric_id = excluded.rubric_id
     returning id`,
    [
      tenantId,
      callId,
      rubricId ?? null,
      result.model,
      JSON.stringify(result.analysis),
      result.metrics.total_score,
      result.metrics.outcome,
      result.metrics.was_disqualified,
    ],
  );
  return rows[0].id;
}
