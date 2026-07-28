# Agent Brief — Legal / IP / Compliance research

> Paste into an agent with **web research** tools. Output is engineering/business guidance, **not
> legal advice** — flag where a qualified attorney is required before GA.

## Product context
**AI Sales Coach** — a self-serve tool for the **individual sales rep** that runs a **desktop app**
which **records both sides of live sales calls locally** (rep mic + prospect system audio),
generates **live coaching cues**, a post-call report, and an AI **persona** for practice. Coaching
logic will be built from purchased/【owner-supplied】 sales-training material but **must be
de-branded**. Pay-as-you-go. EU + US customers expected.

## Research + produce a brief covering
1. **Trademark / IP.** "NEPQ" and "Jeremy Miner" / 7th Level are trademarked. What can we reference
   vs not? How to teach a *similar generic* questioning method without infringing. The
   idea/expression line: **methods and ideas aren't copyrightable, specific wording/examples are** —
   so we can extract logic but must **rewrite** in our own words. Give concrete do/don't rules for
   naming, copy, and training-data extraction.
2. **Call-recording consent.** US one-party vs **all-party** states (list + the interstate "strictest
   law applies" rule); the 2024–2026 **CIPA** class-action wave (Otter/Cresta/ConverseNow); the
   consent UX we must ship (all-party disclosure at call start, per-participant record, audit trail);
   **GDPR** explicit-consent requirements for EU calls.
3. **Emotion recognition.** **EU AI Act Art 5(1)(f)** bans inferring **employee/rep** emotion in the
   workplace; **prospect** emotion is allowed → confirm our role×geography gating
   (`analyze_rep_emotion = region !== "EU"`). Note Art 50 transparency obligations.
4. **ToS / Privacy / DPA / data.** What a self-serve recording tool needs: privacy policy, ToS, DPA,
   a **no-training-on-customer-data** stance, retention/deletion policy, sub-processor list.
5. **Platform ToS.** Any Zoom/Meet/Teams terms issues with **local** audio capture (vs bots).

## Deliverable / Return
Write `legal-ip-brief.md` with a **checklist of required actions before private beta and before
GA**. Return: the **top 5 must-dos** + any red flags. Cite sources (statutes, case names, official
guidance) with URLs.
