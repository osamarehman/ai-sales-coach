import { describe, it, expect } from "bun:test";
import { formatTranscript } from "./transcript";

describe("formatTranscript", () => {
  it("flattens a Fathom transcript to [ts] Speaker: text", () => {
    const input = {
      transcript: [
        { speaker: { display_name: "Alex" }, text: "Hello", timestamp: "00:00:01" },
        { speaker: { display_name: "Rob" }, text: "Hi", timestamp: "00:00:05" },
      ],
    };
    expect(formatTranscript(input)).toBe("[00:00:01] Alex: Hello\n[00:00:05] Rob: Hi");
  });

  it("throws on an empty transcript", () => {
    expect(() => formatTranscript({ transcript: [] })).toThrow();
  });

  it("throws on malformed input", () => {
    expect(() => formatTranscript({ nope: true })).toThrow();
  });
});
