// Pull a JSON object out of an LLM response that may wrap it in a ```json fence or
// surround it with prose. Mirrors the n8n "Validate the data output" extraction so
// we tolerate the same model quirks. Returns the JSON substring, or null if none.
export function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const fenced = raw.match(/```json\s*\n?([\s\S]*?)\n?```/i);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return raw.slice(first, last + 1).trim();
  }
  const trimmed = raw.trim();
  return trimmed.length >= 2 ? trimmed : null;
}

export function parseJsonObject(raw: string): unknown {
  const extracted = extractJsonObject(raw);
  if (!extracted) throw new Error("No JSON object found in model output");
  return JSON.parse(extracted);
}
