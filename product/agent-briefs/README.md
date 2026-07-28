# Agent Briefs — parallel work packages

Each file here is a **self-contained instruction set** to paste into a fresh agent (ideally one with
**web search / research tools**). They're written so you can run several in parallel to save time.
They do **not** overlap with the backend work (RT-0 `realtime` service), which is built in-house in
this repo.

| Brief | Give it to an agent that… | Output |
|---|---|---|
| `desktop-app-agent.md` | can web-research + reason about desktop/audio engineering | `desktop-architecture.md` — stack + architecture + build plan + PoC |
| `frontend-agent.md` | writes SolidJS/Tailwind | new live/practice/credits UI against our API |
| `landing-page-agent.md` | builds a marketing site | live waitlist page + email capture |
| `marketing-agent.md` | does GTM/content | `marketing-foundation.md` — positioning, channels, launch |
| `legal-ip-agent.md` | can web-research law/IP | `legal-ip-brief.md` — trademark, consent, emotion, ToS/DPA |
| `cue-framework-extraction-agent.md` | analyzes source docs (run **after** you paste the PDFs) | `cue-framework.json` — our de-branded cue taxonomy |

## Two rules every brief repeats (non-negotiable)
1. **Never** use the trademarked terms **"NEPQ" / "Jeremy Miner"** in any output — product, code, or
   copy. Use our own generic names for the coaching logic.
2. **Do not** claim cues are "invisible on screen-share" — that requirement was dropped; reps share
   a single window.

## Suggested parallelization
- **Now:** desktop-app, landing-page, marketing, legal/IP (all independent).
- **Frontend:** can start on the live-session UI + cue card; deepens once the desktop WS protocol
  (from the desktop agent) and RT-0 backend land.
- **Cue-framework extraction:** run once you paste the source material.
