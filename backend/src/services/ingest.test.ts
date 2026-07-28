import { describe, it, expect } from "bun:test";
import { normalizeFathomWebhook, matchesFilter } from "./ingest";

describe("normalizeFathomWebhook", () => {
  it("extracts fields from a Fathom object payload", () => {
    const n = normalizeFathomWebhook({
      recording_id: 12345,
      title: "Q3 GAMEPLAN Call",
      recorded_by: { email: "a@x.com", name: "Alex" },
    });
    expect(n).toEqual({
      recordingId: "12345",
      title: "Q3 GAMEPLAN Call",
      advisorEmail: "a@x.com",
      advisorName: "Alex",
    });
  });

  it("handles an array-wrapped body and id fallback + advisor_email", () => {
    const n = normalizeFathomWebhook([{ id: "abc", title: "t", advisor_email: "b@x.com" }]);
    expect(n.recordingId).toBe("abc");
    expect(n.advisorEmail).toBe("b@x.com");
  });

  it("throws when recording_id is missing", () => {
    expect(() => normalizeFathomWebhook({ title: "no id" })).toThrow();
  });
});

describe("matchesFilter", () => {
  it("matches case-insensitively", () => {
    expect(matchesFilter("my GAMEPLAN call", "gameplan")).toBe(true);
  });
  it("skips when the keyword is absent from the title", () => {
    expect(matchesFilter("random 1:1", "GAMEPLAN")).toBe(false);
  });
  it("processes everything when no keyword is set", () => {
    expect(matchesFilter("anything", "")).toBe(true);
  });
});
