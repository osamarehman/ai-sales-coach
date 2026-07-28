import { describe, expect, test } from "bun:test";
import { CueRuntime } from "./cue-runtime";
import type { Completer } from "./cue-engine";
import type { EmittedCue } from "./arbiter";
import type { CueDefinition, CueFramework, CueGoal, Playbook } from "./framework";
import type { TranscriptSegment } from "./transcript";

const cdef = (cueKey: string, priority: string, cooldownS: number | null = null): CueDefinition => ({
  cueKey,
  name: cueKey,
  category: "c",
  stage: null,
  triggerSignal: "t",
  cueText: `do ${cueKey}`,
  priority,
  confidenceMin: null,
  cooldownS,
});
const framework: CueFramework = {
  id: "fw",
  slug: "s",
  name: "Test",
  version: 1,
  status: "active",
  stageModel: [{ slug: "discover", name: "Discover" }],
  gatingConfig: {
    confidence_min: { critical: 0.75, helpful: 0.8, fyi: 0.85 },
    display_seconds: [6, 8],
    hard_cap_per_min: 10, // generous so this test targets warmup / min-gap / cooldown / priority
    budget_per_30min: [8, 20],
    min_gap_seconds: 20,
    warmup_seconds: 30,
    critical_preempts: true,
  },
};
const playbook: Playbook = {
  framework,
  cues: [cdef("talk_ratio_drift", "fyi", 180), cdef("monologue_too_long", "critical", 90), cdef("missing_next_step", "critical")],
  goals: [],
};
const seg = (endMs: number): TranscriptSegment => ({
  speaker: "rep",
  text: "rep talking on the call",
  startMs: Math.max(0, endMs - 5000),
  endMs,
  final: true,
});
type Resp = { candidates: Array<{ cue_key: string; confidence: number }> };
const scripted = (responses: Resp[]): Completer => {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)];
};
const c = (cue_key: string, confidence: number): Resp => ({ candidates: [{ cue_key, confidence }] });

async function drive(rt: CueRuntime, endMs: number) {
  rt.feedTranscript(seg(endMs));
  await rt.flush();
}

describe("CueRuntime — scripted transcript replay", () => {
  test("gating over a call: warmup blocks, talk-ratio fires, critical pre-empts, cooldown/min-gap suppress, next-step at end", async () => {
    const fired: EmittedCue[] = [];
    const rt = new CueRuntime({
      playbook,
      completer: scripted([
        c("talk_ratio_drift", 0.9), //   t=10s: inside warm-up -> blocked
        c("talk_ratio_drift", 0.9), //   t=40s: past warm-up, no prior cue -> EMIT
        c("monologue_too_long", 0.95), // t=50s: min-gap 10s, but critical pre-empts -> EMIT
        c("talk_ratio_drift", 0.9), //   t=60s: cooldown + min-gap -> suppressed
        c("missing_next_step", 0.9), //  t=75s: 25s gap -> EMIT
      ]),
      onCue: (cue) => {
        fired.push(cue);
      },
      now: () => 0, // constant wall clock: evaluation is driven purely by flush()
      debounceMs: 10_000_000,
    });

    await drive(rt, 10000);
    await drive(rt, 40000);
    await drive(rt, 50000);
    await drive(rt, 60000);
    await drive(rt, 75000);
    rt.stop();

    expect(fired.map((f) => f.cueKey)).toEqual(["talk_ratio_drift", "monologue_too_long", "missing_next_step"]);
    expect(fired.map((f) => f.tier)).toEqual(["fyi", "crit", "crit"]);
    expect(fired[0].tsMs).toBe(40000);
    expect(fired[2].tsMs).toBe(75000);
  });

  test("an engine failure never crashes the session and fires no cue", async () => {
    const fired: EmittedCue[] = [];
    const rt = new CueRuntime({
      playbook,
      completer: async () => {
        throw new Error("engine timeout");
      },
      onCue: (cue) => {
        fired.push(cue);
      },
      now: () => 0,
      debounceMs: 10_000_000,
    });
    await drive(rt, 40000); // past warm-up
    rt.stop();
    expect(fired).toEqual([]);
  });
});

// ---- RT-4: scheduled goals through the runtime ----------------------------

const gdef = (goalKey: string, type: string, priority: string, config: unknown): CueGoal => ({
  goalKey,
  label: goalKey,
  type,
  cueText: `do ${goalKey}`,
  priority,
  config,
});
// A completer that fires no signal cues but reports coverage as a function of call-clock elapsed.
const coverageCompleter = (fn: (elapsedMs: number) => Record<string, unknown>): Completer => async (req) => {
  const m = req.user.match(/elapsed: (\d+)m(\d+)s/);
  const elapsedMs = m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : 0;
  return { candidates: [], coverage: fn(elapsedMs) };
};
const goalsPlaybook: Playbook = {
  framework: { ...framework, gatingConfig: { ...(framework.gatingConfig as object), end_reserve_next_step: true } },
  cues: [],
  goals: [
    gdef("consequence_before_pitch", "guard", "critical", { arm_when: "stage_covered:present", require_uncovered: "consequence" }),
    gdef("confirm_next_steps", "window", "critical", { window_last_sec: 300, require_uncovered: "commit", category: "next_step" }),
  ],
};

describe("CueRuntime — scheduled goals", () => {
  test("goal candidates fire through the arbiter: skipped consequence, then the closing next-step", async () => {
    const fired: EmittedCue[] = [];
    const rt = new CueRuntime({
      playbook: goalsPlaybook,
      // rep pitches from ~2:00 without ever asking a consequence question, and never commits.
      completer: coverageCompleter((ms) =>
        ms >= 120_000
          ? { stages_covered: ["connect", "discover"], is_presenting: true }
          : { stages_covered: ["connect", "discover"] },
      ),
      scheduledLengthMin: 10, // closing window = 5:00–10:00
      onCue: (cue) => {
        fired.push(cue);
      },
      now: () => 0,
      debounceMs: 10_000_000,
    });

    await drive(rt, 40000); //  0:40 — past warm-up, only discover covered -> nothing
    await drive(rt, 130000); // 2:10 — presenting without consequence -> consequence_before_pitch
    await drive(rt, 360000); // 6:00 — closing window, no commit yet -> confirm_next_steps
    await drive(rt, 400000); // 6:40 — both already fired (fire-once) -> nothing new
    rt.stop();

    expect(fired.map((f) => f.cueKey)).toEqual(["consequence_before_pitch", "confirm_next_steps"]);
    expect(fired.every((f) => f.tier === "crit")).toBe(true);
    expect(fired[1].category).toBe("next_step"); // the closing cue is the reserved next-step category
  });
});
