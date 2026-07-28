// Per-session orchestrator for the live cue engine (RT-3). It owns the transcript buffer
// and gate state for one call, and runs the loop: a final transcript segment arrives ->
// (EOT flush + trailing debounce) -> compute signals -> ask the cue engine -> arbitrate ->
// emit at most one cue. This is the Domain layer: it composes the pure mechanics
// (signals / cue-engine / arbiter) and owns "when to evaluate". RT-2's STT merge is the
// producer — it calls feedTranscript() as each final segment settles.
//
// Timing split, on purpose: gating decisions use the CALL CLOCK (segment ts) so they're
// deterministic and replayable; the debounce timer uses wall time only to coalesce bursts.
import type { CueDefinition, Playbook } from "./framework";
import { runCueEngine, type Completer } from "./cue-engine";
import { arbitrate, initGate, parseGating, type EmittedCue, type GateState, type Gating } from "./arbiter";
import { computeSignals } from "./signals";
import { evaluateGoals, goalDefs, initCoverage, mergeCoverage, type CoverageState } from "./goal-runner";
import { TranscriptBuffer, type TranscriptSegment } from "./transcript";

const WINDOW_MS = 120_000; // rolling window fed to signals + the prompt (2 min)
const DEBOUNCE_MS = 800; // trailing debounce after the last final segment
const MAX_INTERVAL_MS = 12_000; // force an eval at least this often while speech keeps flowing
const RECENT_CUE_LOOKBACK_MS = 5 * 60_000; // how far back the engine is told cues already fired

export interface CueRuntimeOptions {
  playbook: Playbook;
  completer: Completer;
  onCue: (cue: EmittedCue) => void | Promise<void>;
  now?: () => number; // wall clock (ms); injectable for tests. Debounce/coalesce only.
  scheduledLengthMin?: number;
  debounceMs?: number;
  maxIntervalMs?: number;
}

export class CueRuntime {
  private buf = new TranscriptBuffer();
  private gate: GateState = initGate();
  private coverage: CoverageState = initCoverage(); // cumulative stage/prospect coverage (goal runner)
  private readonly firedGoalKeys = new Set<string>(); // goals already surfaced (fire-once)
  private readonly goalKeys: Set<string>;
  private readonly gating: Gating;
  private readonly cuesByKey: Map<string, CueDefinition>;
  private readonly fired: Array<{ cueKey: string; atMs: number }> = []; // call-clock, for the "recently fired" hint
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushWall = 0;
  private running = false;
  private dirty = false;
  private stopped = false;

  constructor(private readonly opts: CueRuntimeOptions) {
    this.gating = parseGating(opts.playbook.framework.gatingConfig);
    // Goals are presented to the arbiter as pseudo cue-definitions, so signal cues and goal
    // cues share one gate (one-cue-on-screen, budgets) with no special-casing downstream.
    this.cuesByKey = new Map(
      [...opts.playbook.cues, ...goalDefs(opts.playbook.goals)].map((c) => [c.cueKey, c]),
    );
    this.goalKeys = new Set(opts.playbook.goals.map((g) => g.goalKey));
  }

  // Producer entry point (RT-2 STT merge). Appends a final segment and schedules an eval.
  feedTranscript(seg: TranscriptSegment): void {
    if (this.stopped) return;
    this.buf.append(seg);
    this.scheduleTick();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private scheduleTick(): void {
    const debounce = this.opts.debounceMs ?? DEBOUNCE_MS;
    const maxInterval = this.opts.maxIntervalMs ?? MAX_INTERVAL_MS;
    // Don't let a steady stream of segments keep pushing the debounce out forever.
    if (this.lastFlushWall && this.now() - this.lastFlushWall >= maxInterval) {
      void this.flush();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), debounce);
  }

  // Evaluate now, clearing any pending debounce. Public so tests (and the max-interval path)
  // can drive it deterministically. Serialized: never two engine calls in flight at once.
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.stopped) return;
    if (this.running) {
      this.dirty = true; // a tick is in flight — re-run once when it finishes
      return;
    }
    this.running = true;
    try {
      await this.tick();
    } catch (err) {
      // An engine timeout / transient failure must never crash the session — skip this cue.
      console.error("[realtime] cue tick failed", err);
    } finally {
      this.running = false;
      this.lastFlushWall = this.now();
      if (this.dirty && !this.stopped) {
        this.dirty = false;
        await this.flush();
      }
    }
  }

  private async tick(): Promise<void> {
    const nowMs = this.buf.latestMs(); // call clock
    if (nowMs <= 0) return;

    const window = this.buf.window(WINDOW_MS, nowMs);
    const signals = computeSignals(this.buf.all(), WINDOW_MS, nowMs);
    const recentCues = this.fired
      .filter((e) => nowMs - e.atMs <= RECENT_CUE_LOOKBACK_MS)
      .map((e) => ({ cueKey: e.cueKey, agoSeconds: (nowMs - e.atMs) / 1000 }));

    const result = await runCueEngine(
      {
        framework: this.opts.playbook.framework,
        cues: this.opts.playbook.cues,
        signals,
        window,
        recentCues,
        scheduledLengthMin: this.opts.scheduledLengthMin,
      },
      this.opts.completer,
    );

    // Fold the engine's per-window coverage into cumulative call state, then let the scheduled
    // goals (deadline/guard/watch/window) contribute their own candidates alongside the signal
    // cues. Both streams go through the same arbiter, so gating stays uniform.
    this.coverage = mergeCoverage(this.coverage, result.coverage);
    const goalCandidates = evaluateGoals(this.opts.playbook.goals, {
      nowMs,
      scheduledLengthMin: this.opts.scheduledLengthMin,
      coverage: this.coverage,
      firedGoalKeys: this.firedGoalKeys,
    });

    const { emit, gate } = arbitrate([...result.candidates, ...goalCandidates], {
      nowMs,
      stage: result.stage,
      cuesByKey: this.cuesByKey,
      gating: this.gating,
      gate: this.gate,
      scheduledLengthMin: this.opts.scheduledLengthMin,
    });
    this.gate = gate;
    if (emit) {
      this.fired.push({ cueKey: emit.cueKey, atMs: nowMs });
      // A goal is "fired" (fire-once) only once the arbiter actually surfaces it — a goal that
      // loses the tick to a higher-priority cue keeps trying until it's shown or satisfied.
      if (this.goalKeys.has(emit.cueKey)) this.firedGoalKeys.add(emit.cueKey);
      await this.opts.onCue(emit);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
