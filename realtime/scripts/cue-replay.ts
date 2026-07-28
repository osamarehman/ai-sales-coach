// Manual replay of the RT-3 cue engine over a scripted transcript, end-to-end through the
// real signals + arbiter + gating. Default is an OFFLINE scripted completer (deterministic,
// no network); with `--live` and ANTHROPIC_API_KEY set it runs the actual Haiku 4.5 engine.
// Requires DATABASE_URL + a seeded framework (`bun run seed:cues` in backend).
//   bun scripts/cue-replay.ts          # offline scripted engine (plumbing demo)
//   bun scripts/cue-replay.ts --live   # real Haiku inference
import { pool } from "../src/db";
import { config } from "../src/config";
import { loadPlaybook } from "../src/framework";
import { anthropicCompleter, type Completer } from "../src/cue-engine";
import { CueRuntime } from "../src/cue-runtime";

const live = process.argv.includes("--live");

// A condensed ~3-min discovery call that goes wrong: rep monologues, pitches early, fumbles
// the objection, and books no next step.
const SCRIPT: Array<{ speaker: "rep" | "prospect"; text: string; start: number; end: number }> = [
  { speaker: "rep", text: "Hey, thanks for hopping on — how's your week going?", start: 2000, end: 6000 },
  { speaker: "prospect", text: "Busy, honestly. What is this about?", start: 6500, end: 9000 },
  { speaker: "rep", text: "Sure — so we build software that helps sales teams do a lot of things, and I want to walk you through all of it in detail right now", start: 9500, end: 96000 }, // ~86s monologue
  { speaker: "prospect", text: "Okay.", start: 96500, end: 97500 },
  { speaker: "rep", text: "It also does reporting and dashboards and integrations, so let me pull up the pricing tiers", start: 98000, end: 140000 },
  { speaker: "prospect", text: "This sounds pretty expensive.", start: 141000, end: 143000 },
  { speaker: "rep", text: "It's a great value though, let me explain why the enterprise tier is worth it", start: 143500, end: 176000 },
  { speaker: "prospect", text: "I'll need to think about it.", start: 177000, end: 179000 },
  { speaker: "rep", text: "No problem, I'll send some info over.", start: 179500, end: 182000 },
];

// Offline stand-in for the LLM: fires plausible cues based on how far into the call we are.
// (The live engine reads the transcript + signals itself.)
function scriptedCompleter(): Completer {
  const timeline = [
    { afterMs: 90000, cue: "monologue_too_long", conf: 0.9 },
    { afterMs: 138000, cue: "pitching_too_early", conf: 0.88 },
    { afterMs: 143000, cue: "objection_clarify_first", conf: 0.9 },
    { afterMs: 178000, cue: "missing_next_step", conf: 0.85 },
  ];
  return async (req) => {
    const m = req.user.match(/elapsed: (\d+)m(\d+)s/);
    const elapsedMs = m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : 0;
    const hit = timeline.filter((t) => elapsedMs >= t.afterMs).pop();
    // Coverage the goal runner reads: rep connects + does a little discovery, then pitches
    // early (never asking a consequence question) and never books a commitment. This is what
    // fires the scheduled goals (consequence_before_pitch, confirm_next_steps) alongside the
    // signal cues above.
    const coverage = {
      stages_covered: ["connect", "discover"],
      is_presenting: elapsedMs >= 90000,
      prospect_mentioned_budget: elapsedMs >= 143000,
      prospect_named_incumbent: false,
    };
    return { candidates: hit ? [{ cue_key: hit.cue, confidence: hit.conf }] : [], coverage };
  };
}

async function main() {
  const playbook = await loadPlaybook({});
  if (!playbook) throw new Error("no framework found — run `bun run seed:cues` in backend first");

  console.log(`playbook: ${playbook.framework.name} — ${playbook.cues.length} cues, ${playbook.goals.length} goals`);
  console.log(`engine: ${live ? `LIVE (${config.cueModel})` : "offline scripted stub"}\n`);
  if (live && !config.anthropicApiKey) throw new Error("--live needs ANTHROPIC_API_KEY set");

  const fired: string[] = [];
  const rt = new CueRuntime({
    playbook,
    completer: live ? anthropicCompleter() : scriptedCompleter(),
    scheduledLengthMin: 3,
    now: () => 0,
    debounceMs: 10_000_000, // evaluation is driven by flush() below
    onCue: (cue) => {
      fired.push(cue.cueKey);
      console.log(
        `  CUE @${(cue.tsMs / 1000).toFixed(0)}s [${cue.tier}] "${cue.text}"  (${cue.cueKey}, conf ${cue.confidence.toFixed(2)})`,
      );
    },
  });

  for (const s of SCRIPT) {
    rt.feedTranscript({ speaker: s.speaker, text: s.text, startMs: s.start, endMs: s.end, final: true });
    await rt.flush();
  }
  rt.stop();

  console.log(`\n${fired.length} cue(s) fired: ${fired.join(", ") || "(none)"}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
