# Agent Brief — Cue Framework Extraction (run AFTER pasting the source material)

> Paste into an analysis-capable agent, **together with the owner's source material** (PDFs /
> transcripts / examples of the consultative questioning method). This produces our own de-branded
> cue taxonomy as data.

## Product context
**AI Sales Coach** transcribes both sides of a live call in real time (rep + prospect, separate
channels) and can compute prosody (talk-ratio, monologue length, question timing, pitch/pace,
pauses). It fires short **live cues** to the rep. We need a **Cue Framework** — the logic that
decides which cue to show and when — built by **extracting the underlying logic** from the supplied
material into **our own generic system**.

## Absolute rules
- **De-brand.** Never output "NEPQ", "Jeremy Miner", "7th Level", or any trademarked term. Use **our
  own names**. Ideas/methods are fine to reuse; **verbatim wording/examples are NOT** — rewrite
  everything in your own words.
- Keep it **detectable**: every cue must trigger from signals we actually have (live transcript +
  prosody), not from things we can't measure.

## Tasks
1. **Extract** the method's underlying logic from the provided material: its stages, question types,
   tonality patterns, objection-handling flow, and the mistakes it warns against — restated as
   generic sales craft.
2. **Define our stage model** in our own words, e.g.: `Connect → Discover → Frame-Problem →
   Consequence → Qualify → Transition → Present → Commit`.
3. **Map to our cue schema.** For each cue:
   `{ id, category, stage, trigger_signal (precise, from transcript/prosody), cue_text (our
   wording, imperative, short), priority (critical|helpful|fyi), confidence_min, cooldown_s }`.
4. **Scheduled goals** (time-based, fire-once): model `deadline` / `watch` / `window` / `guard` with
   examples (e.g., "consequence question by min 8", "budget mentioned → cue", "confirm next steps in
   last 5 min").
5. **Alert-fatigue gating** defaults: confidence tiers, debounce, one-cue-on-screen, max cues per
   30-min call (~8–12), cooldowns, priority pre-emption.

Align to `product/realtime-plan.md` §3 and the internal reference `product/research/realtime-nepq-cues.md`.

## Deliverable / Return
Write **`cue-framework.json`** (loadable by our `live_playbooks` table) + `cue-framework-notes.md`
(rationale + how each cue is detected). Return: the stage model, the cue count by category, and any
gaps needing owner input.
