# Waitlist Landing Page — Build Spec (handoff)

> ✅ STATUS: SHIPPED (2026-07-24). Built in-house and live at
> **https://sales-coach.shipdeck.dev/join**. Code: `landing/` (SolidJS+Tailwind, its own
> `sc-landing` container) + backend `POST /api/waitlist` (`backend/src/routes/waitlist.ts`,
> `schemas/waitlist.ts`, migration `0005_waitlist.sql`). This spec is kept for reference/iteration.

> Self-contained spec for building the AI Sales Coach waitlist page. House stack
> (SolidJS + Tailwind), standalone one-pager, deployable on its own subdomain. Reuse the
> existing app's design tokens (`frontend/src/app.css`) for brand consistency.

## Goal
Capture emails from **individual sales reps** for early access. One page, one job: convert a
visitor into a waitlist signup. No app, no auth.

## Audience & positioning
The **individual closer / AE / SDR** on commission who wants to win more calls — **not** managers
or enablement teams. Tone: peer-to-peer, confident, a little insider ("your unfair advantage on
every call"). This is a personal tool you run for yourself.

## The offer (3 pillars)
1. **Live cues during the call** — real-time, private coaching prompts while you talk (built on
   proven questioning and discovery techniques).
2. **A report after every call** — see exactly where you lost or won it, and improve.
3. **Practice against your prospect** — an AI persona built from your real call you can drill against.

Pricing angle (teaser only): **pay-as-you-go credits** — "one closed deal pays for months."

## Copy note
Don't market "invisible on screen-share" (that requirement was dropped). Reps just share a single
window, so cues stay on their side naturally. Frame it simply as *"a private coach that runs on
your side of the call."* Also: **do not use the words "NEPQ" or "Jeremy Miner"** anywhere
(trademarked) — describe the coaching generically ("built on proven questioning and discovery
techniques").

## Page structure (top → bottom)
1. **Hero** — headline + subhead + email field + "Join the waitlist" CTA.
   - Headline candidate: *"An AI sales coach in your ear — live, on every call."*
   - Subhead: *"Real-time cues while you talk. A coaching report after. And a practice partner
     built from your real prospect. Made for the rep, not the manager."*
2. **How it works** — 4 steps: *Capture → Live cues → Report → Practice.*
3. **The private-coach angle** — "Your own coach, running quietly on your side of the call. Only
   you see it." (personal, for-the-rep framing)
4. **Why it works** — built on proven questioning and discovery techniques; reads talk-ratio, tone,
   and pace in real time.
5. **Pricing teaser** — pay-as-you-go credits; "one closed deal pays for months."
6. **Final CTA** — email capture again + light scarcity ("early access, limited seats").

## Data capture (required)
- Email input → POST to a `/api/waitlist` endpoint (or a form service) → store in a **`waitlist`**
  table: `id, email (unique, lowercased), source, created_at`. Validate email server-side; dedupe
  on email; basic spam guard (honeypot field + rate-limit). Show a confirmation state on success.
- If standalone with no backend yet: a hosted form (e.g. a simple serverless function + Postgres,
  or a form provider) is fine for v1 — but self-host if quick, to own the list.

## Tech notes
- SolidJS + Tailwind; reuse `frontend/src/app.css` tokens + `components/ui.tsx` primitives where useful.
- Responsive, light/dark, fast (inline critical CSS, no heavy deps).
- Deploy standalone (its own subdomain via the shared Caddy edge, same pattern as the app).

## Done =
Live URL · email validates + stores (deduped) · mobile-clean · light/dark · confirmation state ·
copy follows the guardrail above.
