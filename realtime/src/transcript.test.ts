import { describe, expect, test } from "bun:test";
import { TranscriptBuffer, renderTranscript, type TranscriptSegment } from "./transcript";

const seg = (speaker: "rep" | "prospect", text: string, startMs: number, endMs: number, final = true): TranscriptSegment => ({
  speaker,
  text,
  startMs,
  endMs,
  final,
});

describe("TranscriptBuffer", () => {
  test("drops partials and empty/whitespace-only segments", () => {
    const b = new TranscriptBuffer();
    b.append(seg("rep", "kept", 0, 1000));
    b.append(seg("rep", "partial", 1000, 2000, false)); // not final
    b.append(seg("rep", "   ", 2000, 3000)); // empty after trim
    expect(b.all().map((s) => s.text)).toEqual(["kept"]);
  });

  test("keeps segments end-sorted even when they arrive out of order", () => {
    const b = new TranscriptBuffer();
    b.append(seg("rep", "third", 6000, 7000));
    b.append(seg("prospect", "first", 0, 1000)); // arrives late, sorts to front
    b.append(seg("rep", "second", 2000, 3000)); // inserts in the middle
    expect(b.all().map((s) => s.text)).toEqual(["first", "second", "third"]);
    expect(b.all().map((s) => s.endMs)).toEqual([1000, 3000, 7000]);
  });

  test("latestMs is the max endMs, or 0 when empty", () => {
    const b = new TranscriptBuffer();
    expect(b.latestMs()).toBe(0);
    b.append(seg("rep", "a", 0, 5000));
    b.append(seg("rep", "b", 1000, 2000)); // earlier end, out of order — must not lower latestMs
    expect(b.latestMs()).toBe(5000);
  });

  test("window returns segments overlapping [now - windowMs, now], inclusive at the boundary", () => {
    const b = new TranscriptBuffer();
    b.append(seg("rep", "old", 0, 1000));
    b.append(seg("prospect", "edge", 4000, 5000)); // ends exactly at now-windowMs
    b.append(seg("rep", "recent", 9000, 10000));
    expect(
      b
        .window(5000, 10000)
        .map((s) => s.text)
        .sort(),
    ).toEqual(["edge", "recent"]); // "old" (end 1000 < 5000) excluded; "edge" (== 5000) kept
  });
});

describe("renderTranscript", () => {
  test("formats [speaker m:ss] lines oldest-first, trimming text", () => {
    const out = renderTranscript([seg("rep", "  hello there  ", 0, 6000), seg("prospect", "hi", 390000, 392000)]);
    expect(out).toBe("[rep 0:06] hello there\n[prospect 6:32] hi");
  });

  test("empty input renders an empty string", () => {
    expect(renderTranscript([])).toBe("");
  });
});
