import { toCriterionMap } from "../schemas/analysis";
import type { AnalysisResult } from "./analysis";

const RATING_EMOJI: Record<string, string> = {
  Yes: ":white_check_mark:",
  Partial: ":large_yellow_circle:",
  No: ":x:",
  Disqualified: ":no_entry:",
};

interface Rendered {
  blocks: unknown[];
  text: string;
}

// Headline message posted to the channel. Deterministic — built from stored metrics.
export function renderHeadline(
  title: string,
  repName: string | null,
  result: AnalysisResult,
): Rendered {
  const m = result.metrics;
  const emoji = m.was_disqualified ? ":no_entry:" : ":white_check_mark:";
  const who = repName ? ` — ${repName}` : "";
  return {
    text: `${title}: ${m.outcome} ${m.total_score}/100`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${title}*${who}\n${emoji} *${m.outcome}* · Score *${m.total_score}/100*`,
        },
      },
    ],
  };
}

// Threaded reply: one section per criterion + the overall assessment.
// 11 criteria × (section + divider) + summary ≈ 23 blocks, under Slack's 50-block cap.
export function renderCriteria(result: AnalysisResult): Rendered {
  const blocks: unknown[] = [];
  for (const c of toCriterionMap(result.analysis)) {
    const emoji = RATING_EMOJI[c.rating] ?? ":small_blue_diamond:";
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${emoji} *${c.label}* — ${c.rating} (${c.score})\n${c.reasoning}` },
    });
    blocks.push({ type: "divider" });
  }
  const summary = (result.analysis as { summary?: { overall_assessment?: string } }).summary;
  if (summary?.overall_assessment) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:* ${summary.overall_assessment}` },
    });
  }
  return { text: "Full 11-criteria breakdown", blocks };
}
