// Pure, DB-free transcript model for the live cue engine. RT-2 (STT relay) pushes
// speaker-tagged segments into a per-session TranscriptBuffer; RT-3 reads rolling
// windows out of it to compute signals and to feed the cue-engine prompt.
// Timestamps are the CALL CLOCK (ms since session start), so everything downstream
// — signals, gating, replay tests — is deterministic and independent of wall time.

export type Speaker = "rep" | "prospect";

export interface TranscriptSegment {
  speaker: Speaker;
  text: string;
  startMs: number; // call clock: when this segment's speech began
  endMs: number; // call clock: when it ended
  final: boolean; // AssemblyAI immutable/final segment (partials are dropped by the buffer)
}

// A tiny append-only buffer. Stateful on purpose (one per live session); the metric
// and render helpers over it stay pure.
export class TranscriptBuffer {
  private segs: TranscriptSegment[] = [];

  // Append a FINAL segment. Partials are ignored — the engine only reasons over
  // settled text. Kept in end-time order so windowing is a simple tail scan.
  append(seg: TranscriptSegment): void {
    if (!seg.final) return;
    if (seg.text.trim().length === 0) return;
    const last = this.segs[this.segs.length - 1];
    if (!last || seg.endMs >= last.endMs) {
      this.segs.push(seg);
    } else {
      // out-of-order arrival: insert to keep the array sorted by endMs
      let i = this.segs.length - 1;
      while (i >= 0 && this.segs[i].endMs > seg.endMs) i--;
      this.segs.splice(i + 1, 0, seg);
    }
  }

  all(): readonly TranscriptSegment[] {
    return this.segs;
  }

  // Latest known call-clock time (end of the most recent segment), or 0 if empty.
  latestMs(): number {
    const last = this.segs[this.segs.length - 1];
    return last ? last.endMs : 0;
  }

  // Segments that overlap the trailing window [nowMs - windowMs, nowMs].
  window(windowMs: number, nowMs = this.latestMs()): TranscriptSegment[] {
    const from = nowMs - windowMs;
    return this.segs.filter((s) => s.endMs >= from);
  }
}

// Render segments to a compact, LLM-friendly transcript. Oldest first, one line each:
//   [rep 6:32] we help teams cut onboarding time
// Speaker labels are generic ("rep"/"prospect") — no names, no PII beyond the words.
export function renderTranscript(segs: readonly TranscriptSegment[]): string {
  return segs.map((s) => `[${s.speaker} ${clock(s.endMs)}] ${s.text.trim()}`).join("\n");
}

function clock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
