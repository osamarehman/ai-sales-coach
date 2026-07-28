// Deterministic call signals computed from the transcript buffer (pure, DB-free).
// These are EVIDENCE the cue engine reasons over — not cues themselves. The LLM
// decides which cues fire; feeding it hard numbers (talk-ratio, monologue length,
// question gaps) keeps those decisions grounded and cuts false positives.
import type { TranscriptSegment } from "./transcript";

export interface Signals {
  elapsedSeconds: number; // call-clock seconds elapsed (end of latest segment)
  repTalkRatio: number | null; // rep speaking time / total speaking time, in the window (null if silent)
  longestMonologueSeconds: number; // longest uninterrupted rep span in the window
  repQuestions: number; // rep utterances containing '?' in the window
  secondsSinceLastRepQuestion: number | null; // gap since the rep last asked a question (null if never)
  repWords: number;
  prospectWords: number;
}

const wordCount = (t: string): number => {
  const trimmed = t.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};
const dur = (s: TranscriptSegment): number => Math.max(0, s.endMs - s.startMs);

// windowMs bounds every rolling metric; nowMs defaults to the latest segment end.
export function computeSignals(all: readonly TranscriptSegment[], windowMs: number, nowMs: number): Signals {
  const win = all.filter((s) => s.endMs >= nowMs - windowMs);

  let repMs = 0;
  let prospectMs = 0;
  let repWords = 0;
  let prospectWords = 0;
  let lastRepQuestionEnd: number | null = null;
  let repQuestions = 0;

  for (const s of win) {
    if (s.speaker === "rep") {
      repMs += dur(s);
      repWords += wordCount(s.text);
      if (s.text.includes("?")) {
        repQuestions++;
        if (lastRepQuestionEnd === null || s.endMs > lastRepQuestionEnd) lastRepQuestionEnd = s.endMs;
      }
    } else {
      prospectMs += dur(s);
      prospectWords += wordCount(s.text);
    }
  }

  const totalMs = repMs + prospectMs;

  return {
    elapsedSeconds: Math.round(nowMs / 1000),
    repTalkRatio: totalMs > 0 ? repMs / totalMs : null,
    longestMonologueSeconds: longestRepMonologueMs(win) / 1000,
    repQuestions,
    secondsSinceLastRepQuestion: lastRepQuestionEnd === null ? null : Math.max(0, (nowMs - lastRepQuestionEnd) / 1000),
    repWords,
    prospectWords,
  };
}

// Longest continuous stretch of rep speech uninterrupted by the prospect, in ms.
// A prospect segment breaks the run; consecutive rep segments extend it.
function longestRepMonologueMs(segs: readonly TranscriptSegment[]): number {
  const ordered = [...segs].sort((a, b) => a.startMs - b.startMs);
  let best = 0;
  let runStart: number | null = null;
  let runEnd = 0;
  for (const s of ordered) {
    if (s.speaker === "rep") {
      if (runStart === null) runStart = s.startMs;
      runEnd = Math.max(runEnd, s.endMs);
      best = Math.max(best, runEnd - runStart);
    } else {
      runStart = null;
      runEnd = 0;
    }
  }
  return best;
}
