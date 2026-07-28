import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, buildUserPrompt, runCueEngine, type Completer } from "./cue-engine";
import type { CueDefinition, CueFramework } from "./framework";
import type { Signals } from "./signals";
import type { TranscriptSegment } from "./transcript";

const framework: CueFramework = {
  id: "fw1",
  slug: "default-consultative-v1",
  name: "Default",
  version: 1,
  status: "active",
  stageModel: [
    { slug: "discover", name: "Discover", goal: "Gather facts" },
    { slug: "present", name: "Present", goal: "Show solution" },
  ],
  gatingConfig: {},
};
const cdef = (cueKey: string, priority: string): CueDefinition => ({
  cueKey,
  name: cueKey,
  category: "c",
  stage: null,
  triggerSignal: `trigger for ${cueKey}`,
  cueText: `do ${cueKey}`,
  priority,
  confidenceMin: null,
  cooldownS: null,
});
const cues = [cdef("talk_ratio_drift", "fyi"), cdef("missing_next_step", "critical")];
const signals: Signals = {
  elapsedSeconds: 300,
  repTalkRatio: 0.72,
  longestMonologueSeconds: 40,
  repQuestions: 2,
  secondsSinceLastRepQuestion: 30,
  repWords: 400,
  prospectWords: 150,
};
const window: TranscriptSegment[] = [
  { speaker: "rep", text: "so let me tell you about our product", startMs: 290000, endMs: 300000, final: true },
];
const fixed = (out: unknown): Completer => async () => out;

describe("runCueEngine", () => {
  test("keeps only known cue keys, dedups, clamps confidence to [0,1]", async () => {
    const out = {
      stage: "discover",
      candidates: [
        { cue_key: "talk_ratio_drift", confidence: 1.5, reason: "over" },
        { cue_key: "ghost_cue", confidence: 0.9 }, // hallucinated -> dropped
        { cue_key: "talk_ratio_drift", confidence: 0.4 }, // duplicate -> dropped
      ],
    };
    const r = await runCueEngine({ framework, cues, signals, window, recentCues: [] }, fixed(out));
    expect(r.stage).toBe("discover");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].cueKey).toBe("talk_ratio_drift");
    expect(r.candidates[0].confidence).toBe(1); // clamped from 1.5
  });

  test("malformed model output fires nothing", async () => {
    const r = await runCueEngine({ framework, cues, signals, window, recentCues: [] }, fixed("garbage"));
    expect(r.candidates).toEqual([]);
    expect(r.stage).toBeNull();
  });

  test("empty candidates is valid (the common case)", async () => {
    const r = await runCueEngine({ framework, cues, signals, window, recentCues: [] }, fixed({ candidates: [] }));
    expect(r.candidates).toEqual([]);
  });

  test("system prompt lists the cue catalog + stages and stays de-branded", () => {
    const sys = buildSystemPrompt(framework, cues);
    expect(sys).toContain("talk_ratio_drift");
    expect(sys).toContain("missing_next_step");
    expect(sys).toContain("discover");
    expect(sys).not.toMatch(/nepq|jeremy\s*miner|7th\s*level|neuro-?emotional/i);
  });

  test("user prompt carries the hard signals, recent cues, and transcript", () => {
    const u = buildUserPrompt({ signals, window, recentCues: [{ cueKey: "talk_ratio_drift", agoSeconds: 90 }] });
    expect(u).toContain("rep_talk_ratio: 0.72");
    expect(u).toContain("talk_ratio_drift (90s ago)");
    expect(u).toContain("our product");
  });

  test("passes a system + user prompt to the completer", async () => {
    let seen: { system: string; user: string } | null = null;
    const spy: Completer = async (req) => {
      seen = req;
      return { candidates: [] };
    };
    await runCueEngine({ framework, cues, signals, window, recentCues: [] }, spy);
    expect(seen!.system).toContain("coaching co-pilot");
    expect(seen!.user).toContain("SIGNALS");
  });
});

describe("runCueEngine — malformed-candidate resilience", () => {
  test("one bad candidate is dropped WITHOUT discarding the good ones (per-element parse)", async () => {
    const out = {
      candidates: [
        { cue_key: "missing_next_step", confidence: 0.95, reason: "z".repeat(400) }, // long reason: was fatal via .max(240); now truncated + kept
        { cue_key: "talk_ratio_drift", confidence: "0.9" }, //                          stringified number: was fatal; now coerced + kept
        { cue_key: "talk_ratio_drift", note: "no confidence" }, //                      missing required field: this element dropped, not the tick
      ],
    };
    const r = await runCueEngine({ framework, cues, signals, window, recentCues: [] }, fixed(out));
    const byKey = new Map(r.candidates.map((c) => [c.cueKey, c]));
    expect(byKey.get("missing_next_step")?.confidence).toBe(0.95); // survived alongside the bad element
    expect(byKey.get("missing_next_step")?.reason?.length).toBe(240); // truncated from 400 in code, not schema-rejected
    expect(byKey.get("talk_ratio_drift")?.confidence).toBe(0.9); // coerced from "0.9"
  });
});

describe("runCueEngine — stage/coverage canonicalization (de-brand + slug-drift)", () => {
  test("canonicalizes the model's stage casing and drops unknown/branded stages", async () => {
    const known = await runCueEngine({ framework, cues, signals, window, recentCues: [] }, fixed({ stage: "Discover", candidates: [] }));
    expect(known.stage).toBe("discover"); // normalized to the real slug
    const bogus = await runCueEngine({ framework, cues, signals, window, recentCues: [] }, fixed({ stage: "NEPQ commitment", candidates: [] }));
    expect(bogus.stage).toBeNull(); // unknown/branded stage never reaches persistence
  });

  test("coverage stages_covered is canonicalized and unknowns are dropped", async () => {
    const r = await runCueEngine(
      { framework, cues, signals, window, recentCues: [] },
      fixed({ candidates: [], coverage: { stages_covered: ["Discover", "PRESENT", "made_up_stage"] } }),
    );
    expect(r.coverage.stagesCovered.sort()).toEqual(["discover", "present"]); // casing normalized, junk dropped
  });
});
