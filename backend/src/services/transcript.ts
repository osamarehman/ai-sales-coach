import { z } from "zod";

// Fathom's transcript payload: { transcript: [{ speaker: { display_name }, text, timestamp }] }.
// We also accept an already-flattened { display_name } shape defensively.
const entry = z
  .object({
    speaker: z.object({ display_name: z.string().optional() }).passthrough().optional(),
    display_name: z.string().optional(),
    text: z.string().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const fathomTranscriptSchema = z
  .object({ transcript: z.array(entry) })
  .passthrough();

// Flatten a Fathom transcript to `[timestamp] Speaker: text` lines — the exact
// format the grader prompt expects (ports n8n "Filtering Data" + "Converting JSON to Text").
export function formatTranscript(input: unknown): string {
  const parsed = fathomTranscriptSchema.parse(input);
  if (parsed.transcript.length === 0) {
    throw new Error("Transcript is empty");
  }
  return parsed.transcript
    .map((e) => {
      const name = e.speaker?.display_name ?? e.display_name ?? "Unknown";
      const ts = e.timestamp ?? "";
      const text = (e.text ?? "").trim();
      return `[${ts}] ${name}: ${text}`;
    })
    .join("\n")
    .trim();
}
