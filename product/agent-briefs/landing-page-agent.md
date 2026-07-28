# Agent Brief — Waitlist Landing Page

> Paste into an agent that builds marketing sites. The full, self-contained spec is in
> `product/waitlist-landing-spec.md` — **follow it exactly**. This wrapper adds the must-nots.

## Product context (compact)
**AI Sales Coach** — real-time in-call coaching for the **individual sales rep**, pay-as-you-go
credits. Offer = **live cues during the call + a coaching report after + practice against an AI
persona of your prospect.** House stack: SolidJS + Tailwind. Deploy standalone on its own subdomain.

## Task
Build + deploy the **waitlist landing page** per `product/waitlist-landing-spec.md`: hero + email
capture, how-it-works (Capture → Live cues → Report → Practice), private-coach angle, pricing teaser
(pay-as-you-go), final CTA. Email → a `waitlist` store (unique, lowercased) with a confirmation
state and basic spam guard.

## Must-nots (non-negotiable)
- **No** "NEPQ" / "Jeremy Miner" anywhere — describe the coaching generically ("proven questioning
  and discovery techniques").
- **No** "invisible on screen-share" / "undetectable" claims — frame as "a private coach that runs
  on your side of the call."
- Target the **individual rep**, not managers/teams.

## Deliverable / Return
Live URL + how emails are stored + the copy you shipped.
