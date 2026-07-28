import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHeadline, renderCriteria } from "./slack-render";
import { analysisSchema, deriveMetrics, type Analysis } from "../schemas/analysis";

const here = dirname(fileURLToPath(import.meta.url));
const analysis = analysisSchema.parse(
  JSON.parse(readFileSync(join(here, "../../fixtures/sample-analysis.json"), "utf8")),
) as Analysis;
const result = { analysis, metrics: deriveMetrics(analysis), attempts: 1, model: "test" };

describe("slack-render", () => {
  it("headline is one section carrying title + score + outcome", () => {
    const r = renderHeadline("Acme — GAMEPLAN", "Riley", result);
    expect(r.blocks).toHaveLength(1);
    const json = JSON.stringify(r.blocks);
    expect(json).toContain("Acme — GAMEPLAN");
    expect(json).toContain("90.91/100");
    expect(r.text).toContain("qualified");
  });

  it("criteria renders 11 + summary sections, under Slack's 50-block cap", () => {
    const r = renderCriteria(result);
    const sections = (r.blocks as Array<{ type: string }>).filter((b) => b.type === "section");
    expect(sections.length).toBe(12); // 11 criteria + overall summary
    expect(r.blocks.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(r.blocks)).toContain("Call Opening");
  });
});
