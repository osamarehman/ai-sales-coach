import { describe, expect, test } from "bun:test";
import { computeSignals } from "./signals";
import type { TranscriptSegment } from "./transcript";

const seg = (speaker: "rep" | "prospect", text: string, startMs: number, endMs: number): TranscriptSegment => ({
  speaker,
  text,
  startMs,
  endMs,
  final: true,
});

describe("computeSignals", () => {
  test("talk ratio from speaking durations", () => {
    const segs = [seg("rep", "a b c", 0, 60000), seg("prospect", "d e", 60000, 100000)];
    const s = computeSignals(segs, 120000, 100000);
    expect(s.repTalkRatio).toBeCloseTo(0.6, 5);
    expect(s.repWords).toBe(3);
    expect(s.prospectWords).toBe(2);
    expect(s.elapsedSeconds).toBe(100);
  });

  test("longest rep monologue spans consecutive rep segments, broken by the prospect", () => {
    const segs = [
      seg("rep", "one", 0, 30000),
      seg("rep", "two", 30000, 80000), // consecutive -> one run of 0..80000 = 80s
      seg("prospect", "huh", 80000, 90000), // breaks the run
      seg("rep", "three", 90000, 95000),
    ];
    const s = computeSignals(segs, 120000, 95000);
    expect(s.longestMonologueSeconds).toBeCloseTo(80, 5);
  });

  test("rep questions + time since the last question", () => {
    const segs = [
      seg("rep", "how are you?", 10000, 12000),
      seg("prospect", "fine", 12000, 15000),
      seg("rep", "what is broken?", 50000, 52000),
    ];
    const s = computeSignals(segs, 120000, 60000);
    expect(s.repQuestions).toBe(2);
    expect(s.secondsSinceLastRepQuestion).toBeCloseTo(8, 5);
  });

  test("empty buffer -> nulls, no throw", () => {
    const s = computeSignals([], 120000, 0);
    expect(s.repTalkRatio).toBeNull();
    expect(s.secondsSinceLastRepQuestion).toBeNull();
    expect(s.longestMonologueSeconds).toBe(0);
  });

  test("rolling window excludes stale segments", () => {
    const segs = [seg("rep", "old chatter here", 0, 5000), seg("rep", "new question?", 200000, 205000)];
    const s = computeSignals(segs, 120000, 205000); // window [85000,205000] excludes the old segment
    expect(s.repWords).toBe(2); // only "new question?"
    expect(s.repQuestions).toBe(1);
  });
});
