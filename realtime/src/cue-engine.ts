// The cue engine (RT-3): a debounced Claude Haiku 4.5 call that reads the recent
// transcript + hard signals and decides which coaching cues should fire. Pure mechanic
// with an INJECTABLE completer (tests pass a fake; prod uses Anthropic direct), mirroring
// the backend's openrouter client. Key design choice: the model only picks WHICH cue
// (a cue_key) + a confidence — the rep-facing TEXT always comes from the authored,
// de-branded cue_text, so no LLM free-text can leak brand terms or drift off-message.
import { z } from "zod";
import { config } from "./config";
import type { CueDefinition, CueFramework } from "./framework";
import type { Signals } from "./signals";
import { renderTranscript, type TranscriptSegment } from "./transcript";

// ---- structured output contract -------------------------------------------

// One candidate, validated PER-ELEMENT in runCueEngine (not as part of the array) so a single
// malformed item can't fail the whole parse and discard every good candidate with it. confidence
// is coerced (models sometimes stringify numbers); reason has no schema `.max` (a chatty reason
// must not reject the payload) — it's truncated in code instead.
const CandidateSchema = z.object({
  cue_key: z.string(),
  confidence: z.coerce.number(),
  reason: z.string().optional(),
});

const EngineOutput = z.object({
  stage: z.string().optional(),
  // Per-window observation consumed by the scheduled-goal runner (RT-4). Optional +
  // defensively parsed: a model that omits it simply contributes no coverage this tick.
  coverage: z
    .object({
      stages_covered: z.array(z.string()).optional(),
      is_presenting: z.boolean().optional(),
      prospect_mentioned_budget: z.boolean().optional(),
      prospect_named_incumbent: z.boolean().optional(),
    })
    .optional(),
  candidates: z.array(z.unknown()).default([]), // each element parsed with CandidateSchema below
});

export interface CueCandidate {
  cueKey: string;
  confidence: number; // clamped to [0,1]
  reason: string | null;
}
// What the rep has engaged so far, as seen THIS window (the goal-runner accumulates it).
export interface CoverageObservation {
  stagesCovered: string[]; // framework stage slugs the rep genuinely engaged (filtered to known)
  isPresenting: boolean; // rep is pitching/presenting the solution right now
  prospectMentionedBudget: boolean;
  prospectNamedIncumbent: boolean;
}
function emptyCoverage(): CoverageObservation {
  return { stagesCovered: [], isPresenting: false, prospectMentionedBudget: false, prospectNamedIncumbent: false };
}
export interface CueEngineResult {
  stage: string | null;
  candidates: CueCandidate[];
  coverage: CoverageObservation;
}

// The tool the model is FORCED to call — its input IS our structured output.
const EMIT_TOOL = {
  name: "emit_cues",
  description:
    "Report which coaching cues (if any) should fire right now. Prefer an EMPTY candidates list unless a cue's trigger clearly holds.",
  input_schema: {
    type: "object",
    properties: {
      stage: { type: "string", description: "The sales stage the call is currently in (one of the framework stages)." },
      coverage: {
        type: "object",
        description: "Observed call coverage this turn (for scheduled-goal tracking). Report what the transcript shows; this does not itself fire cues.",
        properties: {
          stages_covered: {
            type: "array",
            items: { type: "string" },
            description: "Stage slugs the rep has genuinely engaged so far (asked a real question of that kind).",
          },
          is_presenting: { type: "boolean", description: "true if the rep is currently pitching/presenting the solution." },
          prospect_mentioned_budget: { type: "boolean", description: "true if the prospect has referenced budget / price / cost." },
          prospect_named_incumbent: { type: "boolean", description: "true if the prospect named a current vendor/tool they already use." },
        },
      },
      candidates: {
        type: "array",
        description: "Cues whose trigger holds right now. Empty if none.",
        items: {
          type: "object",
          properties: {
            cue_key: { type: "string", description: "MUST be one of the provided cue keys." },
            confidence: { type: "number", description: "Calibrated probability 0..1 that the trigger genuinely holds." },
            reason: { type: "string", description: "Brief INTERNAL rationale (<=240 chars). Never shown to the rep." },
          },
          required: ["cue_key", "confidence"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

// ---- injectable completer -------------------------------------------------

export interface CueEngineRequest {
  system: string;
  user: string;
}
// Returns the raw structured object the model produced (the emit_cues tool input).
export type Completer = (req: CueEngineRequest) => Promise<unknown>;

// Default completer: Anthropic Messages API. Tool-use is forced for reliable structured
// output; the (large, static) framework system prompt is marked cacheable; a tight timeout
// + small max_tokens keep the call inside the ~1.5s live-cue latency budget.
export function anthropicCompleter(opts?: { apiKey?: string; model?: string; timeoutMs?: number }): Completer {
  return async (req) => {
    const apiKey = opts?.apiKey ?? config.anthropicApiKey;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — cue engine cannot run");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 3000);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts?.model ?? config.cueModel,
          max_tokens: 512,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: req.user }],
          tools: [EMIT_TOOL],
          tool_choice: { type: "tool", name: "emit_cues" },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
      const tool = data.content?.find((b) => b.type === "tool_use" && b.name === "emit_cues");
      if (!tool || tool.input === undefined) throw new Error("Anthropic returned no emit_cues tool_use");
      return tool.input;
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---- prompt building ------------------------------------------------------

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0);

// Object elements of the framework's stage model. A malformed/null jsonb element is skipped so
// it can't crash prompt-building or slug extraction (`Array.isArray` guards the container, not
// its items — a `[null]` element would throw on `.slug`).
function stageEntries(framework: CueFramework): Array<{ slug?: string; name?: string; goal?: string }> {
  if (!Array.isArray(framework.stageModel)) return [];
  return (framework.stageModel as unknown[]).filter(
    (s): s is { slug?: string; name?: string; goal?: string } => !!s && typeof s === "object",
  );
}

// The framework's stage slugs (used to canonicalize/reject model-supplied stages).
function frameworkStageSlugs(framework: CueFramework): string[] {
  return stageEntries(framework)
    .map((s) => s.slug)
    .filter((s): s is string => typeof s === "string");
}

// Maps a model-supplied stage string to the canonical framework slug (case/whitespace-insensitive),
// or null if it isn't a real stage. Keeps hallucinated/branded stage text out of persistence AND
// stops slug-drift ("Consequence") from reading as UNcovered and firing a false goal nudge.
function canonicalStager(framework: CueFramework): (v: string | undefined | null) => string | null {
  const bySlug = new Map(frameworkStageSlugs(framework).map((s) => [s.toLowerCase(), s]));
  return (v) => (v ? (bySlug.get(v.trim().toLowerCase()) ?? null) : null);
}

// Static, cacheable system prompt: role + stages + cue catalog + the alert-fatigue rules.
// Built from already-de-branded playbook data; introduces no brand terms of its own.
export function buildSystemPrompt(framework: CueFramework, cues: CueDefinition[]): string {
  const stages = stageEntries(framework);
  const stageLines = stages.map((s) => `- ${s.slug}: ${s.name}${s.goal ? ` — ${s.goal}` : ""}`).join("\n");
  const cueLines = cues
    .map((c) => `- ${c.cueKey} [${c.priority}]${c.stage ? ` @${c.stage}` : ""}: ${c.triggerSignal}`)
    .join("\n");
  return [
    "You are a real-time coaching co-pilot for a sales REP on a live call. Each turn you see the recent transcript and hard signals, and you decide which coaching cues (if any) should appear on the rep's private overlay.",
    "",
    "Bias HARD toward silence. Fire a cue ONLY when its trigger clearly holds now. An empty candidate list is the correct, common answer — alert fatigue kills adoption.",
    "",
    "Sales stages (detect which one the call is in):",
    stageLines,
    "",
    "Cue catalog — you may ONLY fire these cue_keys, and only when the stated trigger holds:",
    cueLines,
    "",
    "Also report call COVERAGE each turn in the `coverage` field (it drives scheduled-goal tracking; it does not itself fire cues):",
    "- stages_covered: which of the stages above the rep has genuinely engaged so far in the visible transcript (asked a real question of that kind). Use the stage slugs.",
    "- is_presenting: true if the rep is currently pitching/presenting the solution.",
    "- prospect_mentioned_budget: true once the prospect references budget / price / cost.",
    "- prospect_named_incumbent: true once the prospect names a current vendor / tool they already use.",
    "",
    "Rules:",
    "- Respond by calling the emit_cues tool. If nothing should fire, return an empty candidates array.",
    "- confidence is your calibrated probability (0..1) that the trigger truly holds; treat the hard signals as evidence.",
    "- Do NOT invent cue_keys. Do NOT fire a cue whose trigger is not met. Do NOT repeat a cue listed as recently fired unless the situation clearly recurs.",
    "- reason is a brief internal note for tuning; it is never shown to the rep.",
  ].join("\n");
}

// Dynamic per-tick context: the hard signals, recently-fired cues, and the transcript window.
export function buildUserPrompt(input: {
  signals: Signals;
  window: readonly TranscriptSegment[];
  recentCues: Array<{ cueKey: string; agoSeconds: number }>;
  scheduledLengthMin?: number;
}): string {
  const s = input.signals;
  const sig = [
    `elapsed: ${fmtDuration(s.elapsedSeconds)}`,
    `rep_talk_ratio: ${s.repTalkRatio === null ? "n/a" : s.repTalkRatio.toFixed(2)}`,
    `longest_rep_monologue_s: ${s.longestMonologueSeconds.toFixed(0)}`,
    `rep_questions_in_window: ${s.repQuestions}`,
    `s_since_last_rep_question: ${s.secondsSinceLastRepQuestion === null ? "n/a" : s.secondsSinceLastRepQuestion.toFixed(0)}`,
    `rep_words: ${s.repWords}`,
    `prospect_words: ${s.prospectWords}`,
  ].join("\n");
  const recent =
    input.recentCues.length === 0
      ? "(none)"
      : input.recentCues.map((c) => `${c.cueKey} (${c.agoSeconds.toFixed(0)}s ago)`).join(", ");
  const scheduled = input.scheduledLengthMin ? `scheduled call length: ${input.scheduledLengthMin} min\n` : "";
  return [
    "SIGNALS (hard evidence):",
    sig,
    "",
    `recently fired cues: ${recent}`,
    `${scheduled}RECENT TRANSCRIPT (oldest first):`,
    renderTranscript(input.window) || "(no speech yet)",
  ].join("\n");
}

function fmtDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}m${sec.toString().padStart(2, "0")}s`;
}

// ---- the engine call ------------------------------------------------------

export async function runCueEngine(
  input: {
    framework: CueFramework;
    cues: CueDefinition[];
    signals: Signals;
    window: readonly TranscriptSegment[];
    recentCues: Array<{ cueKey: string; agoSeconds: number }>;
    scheduledLengthMin?: number;
  },
  completer: Completer,
): Promise<CueEngineResult> {
  const system = buildSystemPrompt(input.framework, input.cues);
  const user = buildUserPrompt(input);
  const raw = await completer({ system, user });

  const parsed = EngineOutput.safeParse(raw);
  if (!parsed.success) return { stage: null, candidates: [], coverage: emptyCoverage() }; // malformed => nothing

  const known = new Set(input.cues.map((c) => c.cueKey));
  const seen = new Set<string>();
  const candidates: CueCandidate[] = [];
  for (const raw of parsed.data.candidates.slice(0, 8)) {
    const cp = CandidateSchema.safeParse(raw); // per-element: one bad item never sinks the rest
    if (!cp.success) {
      console.warn("[realtime] dropped malformed cue candidate:", cp.error.issues[0]?.message);
      continue;
    }
    const c = cp.data;
    if (!known.has(c.cue_key) || seen.has(c.cue_key)) continue; // drop hallucinated / duplicate keys
    seen.add(c.cue_key);
    candidates.push({ cueKey: c.cue_key, confidence: clamp01(c.confidence), reason: c.reason ? c.reason.slice(0, 240) : null });
  }

  // Canonicalize model-supplied stages to known slugs (see canonicalStager): drops brand/garbage
  // stages from persistence and normalizes casing drift so coverage stays accurate.
  const canonStage = canonicalStager(input.framework);
  const cov = parsed.data.coverage ?? {};
  const coverage: CoverageObservation = {
    stagesCovered: (cov.stages_covered ?? []).map(canonStage).filter((s): s is string => s !== null),
    isPresenting: cov.is_presenting ?? false,
    prospectMentionedBudget: cov.prospect_mentioned_budget ?? false,
    prospectNamedIncumbent: cov.prospect_named_incumbent ?? false,
  };
  return { stage: canonStage(parsed.data.stage), candidates, coverage };
}
