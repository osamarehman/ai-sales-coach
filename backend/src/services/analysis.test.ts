import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalysis, type Completer } from "./analysis";

const here = dirname(fileURLToPath(import.meta.url));
const goodJson = readFileSync(join(here, "../../fixtures/sample-analysis.json"), "utf8");

describe("runAnalysis (validate -> retry loop)", () => {
  it("validates a good completion on the first attempt", async () => {
    const complete: Completer = async () => goodJson;
    const res = await runAnalysis({ systemPrompt: "sys", transcriptText: "t", complete });
    expect(res.attempts).toBe(1);
    expect(res.analysis.evaluations).toHaveLength(11);
    expect(res.metrics.total_score).toBeCloseTo(90.91, 2);
  });

  it("retries once when the first output is invalid, then succeeds", async () => {
    let calls = 0;
    const complete: Completer = async () => {
      calls += 1;
      return calls === 1 ? "sorry, not json" : goodJson;
    };
    const res = await runAnalysis({ systemPrompt: "sys", transcriptText: "t", complete });
    expect(calls).toBe(2);
    expect(res.attempts).toBe(2);
  });

  it("throws after exhausting attempts on persistently bad output", async () => {
    const complete: Completer = async () => "still not json";
    await expect(
      runAnalysis({ systemPrompt: "sys", transcriptText: "t", complete }),
    ).rejects.toThrow(/failed validation/i);
  });
});
