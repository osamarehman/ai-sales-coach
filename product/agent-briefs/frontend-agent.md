# Agent Brief — Frontend (SolidJS) for the real-time layer

> Paste into a SolidJS/Tailwind engineer agent working in this repo's `frontend/`.

## Product context
**AI Sales Coach** — real-time in-call coaching for the **individual sales rep** (pay-as-you-go
credits). Desktop app captures audio → backend cues → widget. The web dashboard already exists
(8 screens live: Auth, Dashboard, CallsList, Scorecard, Trends, Team, Settings, Onboarding), with a
typed API client `frontend/src/lib/api.ts`, cookie auth, `Protected` route gate, and design tokens
in `app.css` + primitives in `components/ui.tsx`.

**Hard rules:** never use "NEPQ"/"Jeremy Miner"; don't say "invisible on screen-share"; ICP = solo rep.

## Your role
Build the new front-end slices for the real-time layer, reusing existing patterns. **Solid rules:**
read `props.x` (never destructure), `<Show>/<For>` for control flow, signals are called (`sig()`),
`onInput` on text fields, all API calls go through `lib/api.ts`.

## Tasks (build incrementally, each a slice with a runnable check)
1. **Cue Card component** — renders one live cue (text, priority color, confidence, auto-dismiss
   6–8 s). Reused by both the desktop widget (webview) and the dashboard live view. Enforce
   "one cue on screen" + a small queue.
2. **Live Call view** (dashboard) — opens a **WebSocket** to the `realtime` service; shows the
   running transcript (rep vs prospect columns), the live cue feed, a talk-time meter, and session
   controls (start → consent step → stop). Build a small reusable `lib/realtime.ts` WS client
   (reconnect, auth token, typed messages). Align its message types to the desktop agent's proposed
   schema + the backend RT contract (ask for both).
3. **Post-call report** view for a live session — reuse the Scorecard component patterns.
4. **Practice mode** UI — text (v1) then voice against the extracted prospect persona; show turn-by
   turn feedback + a score.
5. **Credits / wallet** UI — balance, usage history, low-balance state, top-up (Stripe) entry point.

## Deliverable
A component + route plan, the new `lib/api.ts` functions, and `lib/realtime.ts`. Everything behind
the existing `Protected` gate. Keep diffs small; reuse `ui.tsx`. Typecheck + `vite build` clean.

## Return
The component/route plan + the list of new API/WS functions you'll add.
