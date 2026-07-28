# AI Sales Coach — Product & Market Research Dossier

*Compiled 2026-07-24. Method: 5 parallel research agents pulling live 2025–2026 web data (analyst market reports, competitor pricing pages, funding disclosures, G2/Reddit/Capterra review themes, developer docs), synthesized here with strategic analysis. Every non-obvious claim in the detailed sections carries an inline source URL. Market-sizing figures disagree across publishers and are shown as ranges; anything unverifiable is flagged inline. This is a working launch document — update it as we validate.*

**Contents**
- [Executive summary](#executive-summary) — the 8 findings that should drive decisions
- [Strategic synthesis](#strategic-synthesis) — positioning, the two moats, the Fathom paradox, real-time wedge, SWOT
- [Recommended launch backlog](#recommended-launch-backlog)
- [Open questions to validate next](#open-questions-to-validate-next)
- **Detailed research** — [1 Market](#part-1--market--category) · [2 RevIntel incumbents](#part-2--competitors--revenue-intelligence-incumbents) · [3 SMB recorders](#part-3--competitors--smb-recorders--notetakers) · [4 Real-time & STT stack](#part-4--real-time-coaching--the-streaming-stt-stack) · [5 ICP, buyers, pricing](#part-5--icp-buyers-pains--pricing)

---

## Executive summary

1. **The market is real, big, and growing.** The sales-coaching-specific slice of conversation intelligence is roughly **high-single-digit billions today (~$8.6B derived), heading toward $15–50B by 2030–2033** across adjacent sub-categories (8–25% CAGR depending on the slice). Buyer appetite is at an all-time high: **81% of sales teams now use AI (up from ~50% in 2024)**, and **86% of enterprises plan to raise AI budgets in 2026**. AI in sales has moved "from a trial category into a budgeted operating expense."

2. **There is a clean, well-defined gap at the SMB tier.** Below it, pure recorders (Fathom, Fireflies) capture transcripts but coach shallowly; above it, Gong/Chorus/Clari grade and coach but charge **enterprise prices plus $5K–$50K platform fees**, demo-gated, annual-only, 15-seat minimums — putting a 15-rep team at **~$30K/year before onboarding**. Nobody sells "graded coaching on the recording you already have" at SMB prices, self-serve, with public pricing.

3. **⚠ But the exact thing we ship today — a post-call graded scorecard — commoditized in the last ~9 months.** Six of seven SMB recorders now ship some scorecard. **Most critically, Fathom — our own upstream data source — launched native "AI Scorecards" (Yes/Partial/No, same mechanic as ours) on its Business tier (~$25–34/user/mo) in October 2025.** A customer already paying Fathom for CRM sync can now grade calls without buying a separate tool. This is the #1 strategic threat and it is shipped product, not a roadmap risk.

4. **Two moats survive a determined competitor; everything else is table stakes.** (a) **Cross-recorder normalization** — score consistently *regardless of which tool recorded the call*; no single-vendor scorecard can do this (a Fathom scorecard only ever sees Fathom calls). (b) **Cross-tenant benchmarking** — "your discovery scores in the 78th percentile for SaaS teams your size"; structurally impossible for single-tenant recorders, and it compounds the longer we operate. The grading scale, CRM push, and Slack alert are now matched by ≥5 competitors.

5. **Real-time in-call coaching is a genuine offensive wedge — and it's still rare and expensive.** Gong deliberately does **not** do live coaching (confirmed by its own 2026 leadership). Cresta/Balto are contact-center and six-figure; Nooks is dialer-bound at ~$5K/seat; only Clari Copilot and sub-scale Avoma push AI cues mid-call. An **SMB-priced, sales-native, real-time cue product is open.** COGS is ~**$1/call-hour** (two orders of magnitude below what the category charges). The hard part is cue *relevance* and rep UX, not cost or latency.

6. **Feature (b) real-time needs a separate capture path — Fathom's API is async-only.** No live/in-progress transcript endpoint exists. The pragmatic v1 architecture is **Recall.ai bot → streaming STT (AssemblyAI/Deepgram) → a gated cue engine → WebSocket into the SolidJS UI.** Ship **2–3 high-confidence triggers first** (talk-ratio, one missed-discovery cue), not all 11 H.E.A.R.T. criteria live on day one.

7. **Beachhead ICP: SMB sales teams of 5–15 reps, Sales Manager as economic buyer, self-serve.** Only segment that transacts without a demo, most vocally priced out of Gong, least coaching bandwidth per rep. Founder-led sales is the top-of-funnel feeder; agencies/fractional coaches are a channel layer once multi-workspace ships.

8. **Consent law is now a vendor-targeted litigation category — a real constraint on the real-time roadmap.** Otter.ai, Cresta, and ConverseNow all face active CIPA/ECPA suits. Today we're one layer removed (Fathom records). **The moment we add live capture (a Recall.ai bot), we become a recorder and inherit direct exposure** — requiring explicit consent UX, two-party-consent/GDPR config, a DPA, and a no-training-on-customer-data stance. Keep documented separation from "emotion recognition" (prohibited in the EU workplace since Feb 2025); H.E.A.R.T. grades *what was said vs. methodology*, not the rep's emotional state — an important legal distinction to protect in both product and messaging.

**Verdict: Green light, with a pivot of emphasis.** The opportunity is real and the SMB gap is genuine, but do **not** lead with "we grade your calls" — that's now a free Fathom checkbox. Lead with the two things single-recorder tools can't copy (cross-recorder + benchmarking), and build hard toward real-time as the differentiator that reprices the product upward.

---

## Strategic synthesis

### The core tension
We built a clean post-call scorecard on top of Fathom. In the 9 months while that was being built, the scorecard itself became a commodity — and Fathom now ships its own. If we compete on "Yes/Partial/No grading + CRM sync + Slack card," we're feature-matching a capability our own data source gives away with a plan the customer already buys. That fight is unwinnable on price or parity. **The product has to be reframed around what a single-recorder vendor structurally cannot build.**

### The two durable moats (build the story and the roadmap around these)

**Moat 1 — Cross-recorder normalization.** SMB sales reality is messy: reps land on whatever tool the prospect's meeting link opens (Fathom here, Teams-native there, Fireflies for that team). Every scorecard on the market is walled to its own vendor's transcripts, and no vendor has any incentive to grade a competitor's calls well. **A rubric that scores identically regardless of capture source is something no single-recorder scorecard can offer.** This reframes the user's "add more integrations" feature from a nice-to-have into the primary defensibility play. It only stays a moat if we ship ingestion breadth *faster than customers fragment across tools* — so this is now a priority, not a backlog item.

**Moat 2 — Cross-tenant benchmarking.** Every competitor is single-tenant by construction: a company's Fathom instance only ever sees its own calls. "Your close rate is in the Nth percentile for your industry and team size" is a report **none of them can produce, no matter how much scoring logic they add** — it requires aggregated data across customers. As a multi-tenant SaaS, we are the only entity in the entire comparison set structurally positioned to build this. It compounds: more tenants → sharper benchmarks → stronger reason to join. **We should start accumulating the (anonymized, aggregated) data model for this now**, even before the feature ships, because the moat is the data, not the chart.

### The Fathom paradox (name it, plan around it)
Fathom is simultaneously our **data source** and now a **competitor** at the point of capture. This is a genuine vulnerability. Four responses:
1. **Don't compete on the scorecard mechanic.** Matching Fathom's Yes/Partial/No feature-for-feature just invites "why not use the free one?"
2. **Lean into what Fathom won't do:** score across recorders, benchmark across companies, ship an *opinionated pre-built* H.E.A.R.T. methodology (Fathom ships a blank scorecard *builder* — their docs admit SPICED/MEDDPICC are "not built-in (yet)"), and go deep on the manager coaching *workflow* (1:1s, calibration, trend-lines) rather than call-level output.
3. **De-risk the dependency.** Add Fireflies + Otter + a generic transcript/upload path so no single upstream vendor is a single point of failure — and so a Fathom pricing/API change can't strand us.
4. **Watch the up-stack drift.** Fathom just posted $30M ARR (3x YoY) and is publicly telling the market it's moving from "capturing conversations" to "automating the work that follows." Assume they keep investing in coaching. Our answer is the two moats above plus real-time, none of which are on Fathom's stated path.

### Real-time — the offensive wedge
This is where the user's Feature (b) vision and the market gap line up perfectly. Real-time coaching is proven (Cresta/Balto have guided 250M+ calls), validated by buyers (vendor-reported win-rate lifts of 8–12%, 30–50% faster ramp), and yet **absent from the SMB sales tier**: the incumbents that do it are contact-center-priced or enterprise-only. Building it well would let us reprice from a ~$45 coaching add-on toward the $75–150 "live coaching" band the market already pays. It is technically feasible today at ~$1/call-hour COGS. The two things that decide success are **cue relevance** (ship few, high-confidence triggers; alert fatigue kills adoption) and **rep-facing UX** — not the AI cost, which is commodity. This is the single most important thing to build toward, but it should follow (not precede) locking the two moats, because it also carries the biggest new legal surface.

### Positioning
**Recommended primary line:** *"Objective sales coaching for growing teams — every call graded against a fixed methodology, benchmarked across your team and your peers, live in minutes. No platform fee."*

Three message pillars, each mapped to a moat/gap the research proved:
- **Legible, not a black box.** A fixed, inspectable 11-criterion H.E.A.R.T. rubric (same criteria every call, Yes/Partial/No, evidence attached) vs. the opaque "AI deal-health score" reviewers repeatedly say "can't grasp the nuances." This is a trust story SMB buyers can verify. *(Methodology-as-product is how Gong built a category — closer to that than to a configurable notetaker.)*
- **Every call, every recorder.** Coaching that doesn't care which tool captured the call — and benchmarks you against teams like yours. *(The two moats.)*
- **Priced and sold like SMB software.** No platform fee ever, self-serve signup, public pricing, first graded call in minutes. *(The anti-Gong wedge — the single most-quoted incumbent pain.)*

Avoid: "sentiment/emotion analysis" framing (EU AI Act exposure), and leading with "AI notes/summaries" (that's the commodity below us).

### Beachhead & pricing (validated hypothesis)
SMB 5–15 reps, Sales Manager buyer. No platform fee, month-to-month available, ~20% annual discount, 1–2 seat minimum, public pricing. Proposed tiers:

| Tier | $/rep/mo (annual) | For | Headline inclusions |
|---|---|---|---|
| **Starter** | $25 | Solo / founder-led | Unlimited H.E.A.R.T. grading on existing recordings, per-rep trends, weekly Slack digest |
| **Growth** *(beachhead)* | $45 | 5–15 rep teams | + per-call Slack coaching card, team leaderboard, manager coaching queue, CRM sync |
| **Scale** | $75 | Multi-pod / agencies | + multi-workspace, custom rubric editor, API, SSO, benchmarking |

At 10 reps that's **$5,400/yr vs. Gong's ~$28–36K** for comparable graded coaching — priced like a recorder, capable like an enterprise platform. Real-time, once shipped, justifies a premium add-on or a fourth tier.

### SWOT

| | Helpful | Harmful |
|---|---|---|
| **Internal** | **Strengths:** live product; opinionated fixed rubric; zero recording/storage COGS (BYO-recorder); multi-tenant from row one (enables benchmarking); cheap LLM grading | **Weaknesses:** scorecard is now commodity; hard dependency on Fathom (also a competitor); no live-capture path yet; no benchmarking data accumulated yet; single-founder/small team vs. funded incumbents |
| **External** | **Opportunities:** wide-open SMB price gap; real-time absent at SMB tier; incumbent consolidation churn (Clari+Salesloft messy, Momentum absorbed by Salesforce, Chorus buried in ZoomInfo) creates displaced buyers; cross-recorder + benchmarking uncontested | **Threats:** Fathom/Fireflies bundling scoring for ~free; CRM/UC giants (HubSpot Breeze, MS Copilot, Salesforce Agentforce) bundling coaching; consent-law litigation now targets AI vendors directly; Google/MS tightening third-party meeting bots threatens the whole ingestion model |

### How this changes the build (ties to the stated new features)
- **Feature (a) multi-recorder ingestion → promoted to core defensibility.** Priority order: generic transcript/paste upload (instant, recorder-agnostic proof) → Fireflies → Otter → Zoom/Meet/Teams. This is Moat 1.
- **Feature (b) real-time in-call cues → the offensive differentiator.** Separate Recall.ai capture path; streaming STT; a *gated* cue engine (deterministic pre-filters → small fast LLM only when they fire); 2–3 triggers at launch. Gate behind explicit consent UX.
- **New: cross-tenant benchmarking → Moat 2.** Design the anonymized aggregate data model now; ship percentile reports on the Scale tier.
- **New: legal/consent hardening → prerequisite for real-time.** Consent disclosure, two-party-consent + GDPR config, DPA, no-training default. Not optional once we capture audio ourselves.

---

## Recommended launch backlog

Ordered by leverage, one slice at a time (see `TASKS.md` for build sequencing):

1. **Reposition the site + product copy** around the three pillars above (legible / every-recorder / SMB-priced). Kill "we grade your calls" as the lead.
2. **Ship a recorder-agnostic ingestion proof** — transcript paste/upload — so the cross-recorder story is demonstrable today, before deep integrations land.
3. **Public pricing page** with the three tiers; self-serve checkout; no "contact sales."
4. **GTM assets** (next research/build phase): landing page, onboarding email sequence, lifecycle + activation emails, cold outbound to the SMB-manager persona, comparison pages ("vs. Gong," "on top of Fathom").
5. **Add Fireflies + Otter ingestion** (Moat 1 depth).
6. **Benchmarking data model** (Moat 2 groundwork) + first percentile report.
7. **Real-time spike** — Recall.ai + streaming STT + 2 triggers behind a consent gate (Feature b), as a design-partner beta.
8. **Legal/consent hardening** before real-time GA.

---

## Open questions to validate next

- **Willingness to pay** ~$45/seat for the beachhead — validate with 5–10 target managers before committing the pricing page.
- **Do SMB managers actually want real-time**, or do they prefer async post-call review they can do on their schedule? (Determines how hard to push Feature b vs. the two moats.)
- **How fast does Fathom's native scorecard erode our wedge** among Fathom-primary customers — and does that argue for reducing Fathom-primary positioning?
- **Benchmarking privacy model** — what aggregation guarantees make cross-tenant percentiles sellable without spooking buyers about their call data.
- **Consent/legal sign-off** — required scope before we ship any live-capture bot (which US states, GDPR basis, DPA, training stance).
- **Platform bot-restriction exposure** — how much of our ingestion depends on Fathom's bot successfully joining Meet/Teams as those platforms tighten.

---
---

# Detailed research

*The five sections below are the raw sourced findings from the research agents, lightly edited for consistent headings. Inline URLs are the primary evidence for every non-obvious claim.*

---

## Part 1 — Market & Category

AI Sales Coach sits at the intersection of four overlapping, inconsistently-defined analyst categories. No single category is "the" market — the product is a narrow, sales-coaching-specific slice of **conversation intelligence**, adjacent to **revenue intelligence**, **sales enablement/readiness**, and built on the same ingestion layer as **AI meeting assistants**.

### Category sizing (TAM view, ~2030 horizon)

| Category | Base-year size | ~2030 (or nearest) forecast | CAGR | Source(s) |
|---|---|---|---|---|
| Conversation intelligence software | $25.3–28.5B (2025) | $52.03B by 2030 / $60.3B by 2036 | 8.2–12.7% | [Future Market Insights](https://www.futuremarketinsights.com/reports/conversation-intelligence-software-market); [Research and Markets](https://www.researchandmarkets.com/reports/6226068/conversation-intelligence-software-global-market) |
| Revenue intelligence platforms | $2.1–5B (2024/25) | $9.8–10.8B by 2032 | 12.1–21.5% | [Verified Market Research](https://www.verifiedmarketresearch.com/product/revenue-intelligence-platform-market/); [Custom Market Insights](https://www.custommarketinsights.com/report/revenue-intelligence-market/) |
| Sales enablement platform | $3.45–5.23B (2024/25) | $12.78B by 2030 (GVR, most-cited) | 16.3–22.1% | [Grand View Research](https://www.grandviewresearch.com/industry-analysis/sales-enablement-platform-market-report) |
| Sales readiness platform (niche) | $1.5–2.5B (2022/23) | $4.5B by 2030 / $7.8B by 2032 | 13.2–15% | [OpenPR](https://www.openpr.com/news/3757089/sales-readiness-platform-market-size-and-forecast) |
| AI meeting assistants / notetakers | $1.2–3.67B (2024/25) | $6.28B–$72B by 2033–35 (huge disagreement) | 18.0–34.7% | [Grand View Research](https://www.grandviewresearch.com/industry-analysis/ai-meeting-assistant-market-report); [Market.us](https://market.us/report/ai-meeting-assistant-market/) |

**Conversation intelligence** is the most useful anchor: ~$25–29B in 2025 → ~$52–60B by 2030–2036. Crucially, [FMI](https://www.futuremarketinsights.com/reports/conversation-intelligence-software-market) breaks it down by use case: **"Sales Coaching" is 34.0% of conversation-intelligence spend** in 2026 — implying a **sales-coaching-specific slice of roughly $8.6B in 2025** (extrapolation from FMI's segment share, not independently published), the closest thing to a real SAM for this product.

> Don't conflate **conversation intelligence** (call analysis, our category) with the much larger **conversational AI** market (chatbots/IVR, $11.6–19.2B → $41–155B) — different products, frequently confused in search results.

**Data-quality flag:** several SEO-oriented publishers report a "sales coaching software" market of **$54–62B in 2025** — almost certainly **mislabeled** (5–7x larger than the entire sales-enablement category that should contain it; likely conflated with the human executive-coaching services industry). Treat those figures as unreliable. The internally-consistent anchor is the $1.5–13B range across sales-readiness/enablement, or the ~$8.6B coaching slice of CI.

**Analyst convergence signal:** in December 2025 Gartner published its **first-ever Magic Quadrant for "Revenue Action Orchestration" (RAO)**, formally merging sales engagement + conversation intelligence + revenue intelligence into one category (Gong and Outreach named Leaders — [Gong](https://www.gong.io/press/gong-named-a-leader-in-2025-gartner-magic-quadrant-for-revenue-action-orchestration)). The analyst world now sees these as one market.

### Trends & tailwinds, 2025–2026

- **AI adoption in sales is surging.** 81% of sales teams use AI in 2026 (up from ~50% in 2024); 41% of enterprise B2B teams ran ≥1 AI SDR in production by Q1 2026 (up from 12% a year earlier). Figures are vendor-survey-sourced (directional): [Laxis](https://www.laxis.com/blog/state-of-ai-sales-agent-2026/), [Autobound](https://www.autobound.ai/blog/state-of-ai-sales-prospecting-2026).
- **Real-time in-call coaching is becoming its own sub-category.** Reported 2026 enterprise bar: sub-400ms suggestion latency, 30+ languages, on-device PII redaction. Vendor-reported impact (unverified): win rates +8–12% in three months, ramp 30–50% faster, 78% rate real-time "very valuable." [Revenue.io](https://www.revenue.io/blog/the-5-best-live-coaching-tools-for-sales-calls), [The Quantum Leap](https://www.thequantumleap.business/blog/ai-driven-call-coaching-2026-capabilities-use-cases-trends). **Directly relevant to our Feature (b): the market is normalizing live coaching, which risks making a post-call-only product look dated within the forecast window.**
- **Notetakers are becoming a bundled commodity.** Zoom AI Companion is free in every paid plan (4x YoY MAU growth in Q2 2026); Google "Take notes for me" ships in Workspace. Tailwind for adoption, headwind for standalone monetization. [ToolDirectory](https://tooldirectory.ai/blog/ai-notetakers-2026-otter-fireflies-granola-fathom-read).
- **Consolidation/M&A accelerated:** **Clari + Salesloft** merged Dec 2025 ($10T revenue "under management," 5,000+ customers — [Salesloft](https://www.salesloft.com/company/newsroom/clari-salesloft-merger)); **Seismic + Highspot** agreed Feb 2026 (~$6B, unconfirmed); **Showpad + Bigtincan** under Vector Capital Oct 2025; **Momentum acquired by Salesforce** Mar 2026. Funding: **Fireflies $1B+ valuation** (2025 tender), **Gong $4.5B secondary / >$500M ARR run-rate** ([Sacra](https://sacra.com/c/gong/)), **Otter crossed $100M ARR** Mar 2025, **Fathom $10M→$30M ARR in 2025 at ~$73M valuation** ([Latka](https://getlatka.com/companies/fathom.ai)) — still much smaller than Gong/Fireflies/Otter.
- **Buyers shifting from novelty to proof:** 86% of enterprises plan to raise AI budgets in 2026; integration with the existing stack and quantified outcomes have replaced brand/roadmap as the shortlist test — raising the bar for standalone point solutions (bundling headwind).

### Headwinds & risks

- **Transcription is fully commoditized.** Whisper API runs $0.003–0.006/min (~75% cheaper than AWS Transcribe); purpose-built engines beat Whisper on accuracy/latency. Good for our COGS, bad for defensibility — every competitor has the same cheap input. [TokenMix](https://tokenmix.ai/blog/whisper-api-pricing).
- **Incumbents bundle coaching for free — including our own data source.** Zoom AI Companion (free), Google Workspace notes, HubSpot Breeze Copilot deal coaching, MS Copilot in Dynamics 365, Salesforce Agentforce. **Most material: Fathom itself now ships native "AI Scorecards" grading against a chosen methodology on its Business plan (~$29–39/user/mo)** — [fathom.ai/solutions/sales](https://www.fathom.ai/solutions/sales). Our upstream data source is now a direct competitor at the point of capture. Even Gong is under pricing pressure (buyers pushed into ~$250/user/mo bundles; Chorus undercuts 10–20%).
- **Call-recording consent law is an active, vendor-targeted litigation risk.** ~10–13 US all-party-consent states (list disputed; the stricter state's law controls interstate calls; a beep tone alone is not reliable consent — [Hyperbound](https://www.hyperbound.ai/blog/sales-call-recording-laws-compliance)). Live suits now target the **AI vendor directly**: *In re Otter.AI Privacy Litigation* (MTD argued May 2026, undecided), **Cresta** (CIPA re: United Airlines calls), **ConverseNow** (MTD denied Aug 2025, case proceeds — [Wilson Sonsini](https://www.wsgr.com/en/insights/us-federal-court-allows-cipa-class-action-against-ai-customer-service-provider-to-proceed.html)). EU/UK: GDPR requires freely-given, informed, unambiguous consent (silence ≠ consent). **EU AI Act Article 5(1)(f) prohibits workplace emotion-inference AI since Feb 2, 2025 (fines to €35M / 7% turnover)** — a rubric-based content/skill scorecard is distinct, but keep documented separation. [Bird & Bird](https://www.twobirds.com/en/insights/2025/global/ai-and-the-workplace-navigating-prohibited-ai-practices-in-the-eu).
- **Platform bot restrictions threaten the ingestion model.** Google Meet began flagging third-party recorder bots as "potential risk" (Mar 2026); Microsoft reported tightening bot access Q3 2026, naming Fathom and Fireflies. Since our pipeline depends on Fathom joining the call, this is a second-order but direct supply risk — pushing the market toward "bot-free" local capture. [Basil AI](https://basilai.app/articles/2026-06-13-bot-vs-bot-free-ai-notetaker-google-meet-teams-2026.html).

---

## Part 2 — Competitors — Revenue-Intelligence Incumbents

| Company | Live in-call AI coaching? | Entry price (real, not headline) | Scale signal |
|---|---|---|---|
| Gong | **No** — post-call only, by design | ~$1,400/seat/yr + $5K–$50K/yr platform fee, 12-mo, ~15-seat floor | $500M ARR, $4.5B valuation (down from $7.25B), ~4–5K customers |
| Chorus (ZoomInfo) | **No** — "real-time" = contact-data enrichment | ~$8K/yr for 3 seats, then ~$1,200/seat/yr | Folded into ZoomInfo ($1.25B 2025 revenue) |
| Clari (Copilot/Wingman) | **Yes** — live AI battlecards | Copilot ~$1,080–1,320/seat/yr; full stack $400+/user/mo | Merged w/ Salesloft: 5,000+ customers, ~$450M ARR |
| Salesloft (Conversations/Rhythm) | **Partial** — human whisper, AI async | ~$125–165/user/mo | ~$300M ARR pre-merger; now in Clari |
| Avoma | **Yes** — Live Answer Assistant cue cards | $19–39/seat/mo (real CI/RI ~$87 once stacked) | ~$18.2M raised, ~300+ customers — genuinely small |
| Momentum.io | **No** — near-real-time Slack risk alerts | was $69–99/user/mo | $18M raised; **acquired by Salesforce Mar 2, 2026** |

**Gong** — category-defining "Revenue AI," enterprise-led (>1,000-employee accounts ~60% of ARR — [Contrary Research](https://research.contrary.com/company/gong)). Feb 2026 "Mission Andromeda" added Gong Enable (AI Call Reviewer, AI Trainer roleplay, AI Coach). **No live coaching — leadership confirmed the AI Call Reviewer runs post-call "because you want to grade the whole call as a whole"** ([VentureBeat](https://venturebeat.com/technology/gong-launches-mission-andromeda-with-ai-sales-coaching-chatbot-and-open-mcp)). Pricing: Foundation ~$1,298–1,426/user/yr; bundled ~$2,880–3,000; + $5K–$50K platform fee + $15K–65K implementation; 12-mo only, ~15-seat minimum ([Nimit AI](https://nimitai.com/blog/gong-pricing-2026)). $500M ARR, >55% YoY, $4.5B secondary valuation Nov 2025. Top complaint across 6,500+ G2 reviews (4.7/5): mandatory platform fees, forced bundling, 5–15% auto-renewal uplifts ([Sybill](https://www.sybill.ai/blogs/gong-pricing)).

**Chorus (ZoomInfo)** — CI sold as an extension of ZoomInfo's data platform; "real-time" = pulling a prospect's profile from ZoomInfo's contact DB when they join, not coaching. ~$8K/yr base for 3 seats, then ~$1,200/seat/yr, effectively "contact sales." Transcription ~80–90% accuracy; opaque bundled pricing ([Tomba](https://tomba.io/blog/chorus-pricing-reviews-pros-and-cons)).

**Clari (Copilot/Wingman)** — enterprise revenue orchestration; **strongest real-time story** (Copilot surfaces battlecards mid-call on competitor/pricing/technical cues, live talk-ratio + sentiment — [Clari](https://www.clari.com/blog/meet-copilot-revenue-collaboration-governance-just-got-easier/)). Merged with Salesloft Dec 2025; seven months in, still separate interfaces, rising bundle prices, a 76-person layoff Feb 2026 ([GetMaxIQ](https://www.getmaxiq.com/blog/clari-salesloft-merger-guide)). Full stack $400+/user/mo.

**Salesloft** — engagement-first; Live Call Studio is genuine live *human* monitoring (listen/whisper/join), but Rhythm's AI recommendations are async, not mid-call. ~$125–165/user/mo; ~$300M ARR plateau pre-merger ([Forrester](https://www.forrester.com/blogs/clari-salesloft-merger-a-bold-high-stakes-bid-for-market-dominance/)).

**Avoma** — the value pick; genuine live AI coaching (Live Answer Assistant pops Answer Cards on objections/competitor mentions/qualification gaps — [Avoma](https://www.avoma.com/conversation-intelligence/real-time-sales-guidance-software)) at $19–39/seat/mo. But sub-scale (~$18.2M raised, ~300 customers, ~59 employees), low brand trust, and top G2 complaint is recorder reliability (bot joins late/drops).

**Momentum.io** — not a coaching tool (Slack "Smart Deal Rooms" + risk alerts); **acquired by Salesforce Mar 2, 2026** to feed Agentforce — real product-continuity risk for its customers.

**Takeaways for us:** every incumbent monetizes on top of a mandatory platform/implementation fee (Gong $5K–$65K), seat minimums (~15), and 12-month contracts — a $20K–$40K+ floor for a 5–20-rep team before anyone logs in. Genuine live AI coaching is still rare (only Clari Copilot + small Avoma), so real-time is a real future wedge — but a **post-call** scorecard isn't "behind" by shipping post-call. The sharper gap *today* is **transparency**: every incumbent's scoring is an opaque, continuously-tuned "AI health score" reviewers say can't "grasp the nuances." Nobody publishes a fixed, inspectable rubric. And the sector is mid-consolidation (Clari/Salesloft messy, Chorus buried in ZoomInfo, Momentum absorbed) — each a moment to catch displaced buyers. Staying strictly bring-your-own-recorder skips the recording infrastructure cost and competes purely on the grading layer — the part that draws the most complaints.

---

## Part 3 — Competitors — SMB Recorders & Notetakers

| Tool | Entry paid price | Native call **scoring**? | Real-time / live | API + webhooks |
|---|---|---|---|---|
| **Fathom** | $20/mo indiv · $19–34/user/mo team | **Yes** — AI Scorecards, Yes/Partial/No, Business only | Talk-time + keyword alerts (not full live coaching) | Public REST API + 1 webhook event (Oct 2025) |
| **Fireflies.ai** | $10–19/seat/mo (annual) | **Yes** — Scorecard/Coach "AI Skills" apps, Business+ | **Live Assist** (Nov 2025) — real-time answers + objection coaching | GraphQL API + webhooks, Business/Enterprise |
| **Otter.ai** | $8.33–19.99/user/mo | Partial — deal-risk insights + scorecards, **Enterprise only** | Weaker/less-verified live story | API & Webhooks **Enterprise-only** |
| **Read.ai** | $15/mo (annual) | **Yes** — Speaker Coach + sales scorecards | Strong — live dashboard, live sentiment, in-call tips | Webhooks; tier gating unclear |
| **tl;dv** | ~$18/seat/mo (annual, est.) | **Yes** — AI Coaching Hub, playbook scorecards | Live transcript + live template auto-fill (MEDDIC fills as you talk) | REST API + webhooks + MCP, Business only |
| **Grain** | ~$19/seat/mo (annual, est.) | **Yes** — timestamped coaching comments, SPICED/MEDDIC | Live transcript/translation, not marketed as live coaching | Native + Zapier/n8n; gating unconfirmed |
| **Sembly** | $10/mo (annual) / $20/user/mo Pro | **No** — sentiment/engagement only | Not a focus | Outbound webhooks scale with plan |

**The headline: six of seven tools already ship some form of scorecard, not just summaries** — most shipped in a single Oct–Nov 2025 window. Sembly is the lone holdout.

**Fathom (our ingestion source), extra depth:** CEO Richard White publicly frames "meetings are data to harness" with a 12–18mo vision to become "enterprise-wide intelligence infrastructure," moving from "capturing conversations" to "automating the work that follows" ([AI Media House](https://www.aimmediahouse.com/leaders-opinion/meetings-are-data-to-harness-says-fathom-ceo-richard-white)). Pricing (verified [fathom.ai/pricing](https://fathom.ai/pricing)): Free / Premium $20 ($16 annual) / Team $19/user ($15) / **Business $34/user ($25) — CRM sync, Deal View, Coaching metrics + AI Scorecards** / Enterprise custom. **AI Scorecards (launched Oct 2025, Business-only) grade Yes/Partial/No per criterion — structurally identical to our H.E.A.R.T. scale** — but criteria are fully admin-defined; Fathom's own docs say SPICED/MEDDPICC are reference templates "not built-in (yet)" ([help.fathom.video](https://help.fathom.video/en/articles/7906049)). API ([developers.fathom.ai](https://developers.fathom.ai/api-overview)): REST, rate-limited 60 req/60s, **one webhook event** (`new-meeting-content-ready`), signature-verified — young, thin surface. Financials: $30M ARR 2025 (from $10M 2024), ~$73M valuation. **Is Fathom moving toward scoring calls itself? Unambiguously yes — it's shipped product on their top tier, not a roadmap risk.** *(Don't conflate with "Fathom Health," a different company.)*

**Fireflies.ai** — most structurally similar to us. Sells scorecards as standalone "AI Skills" apps ([Discovery Call Scorecard](https://fireflies.ai/skills/sales/discovery-call-scorecard-ai-app), Demo Call Scorecard) with timestamped Yes/No + auto-push to Salesforce/HubSpot/Slack, plus Sales Coach / Objection Handler / Sentiment skills. **Live Assist** (Nov 13, 2025) surfaces answers + objection coaching mid-call — a real capability gap vs. Fathom. Free / Pro $10 / Business $19 / Enterprise $39 (annual); AI features gated behind a shared credits pool.

**Otter.ai** — coaching is a newer Enterprise-gated bolt-on (deal insights → Salesforce; scorecards Enterprise-only — the narrowest availability of the set). API & Webhooks are an **Enterprise-tier line item only**.

**Read.ai** — general meeting analytics with a sales layer; **strong live story** (real-time meeting dashboard, live sentiment/engagement, pivotal-moment alerts). Free / Pro $15 / Enterprise $22.50 / Enterprise+ $29.75.

**tl;dv** — markets as sales-coaching-first; AI Coaching Hub + playbook scorecards (Business tier); genuinely live **template auto-fill** (MEDDIC fields populate mid-call). REST API + webhooks + MCP (Business only). *(Pricing is a third-party estimate — their pricing page 404'd during research.)*

**Grain** — strong deal-intelligence framing for SMB RevOps; timestamped manager coaching comments + SPICED/MEDDIC extraction; not marketed around live coaching. Least transparent pricing (~$19/seat/mo Business per [Vendr](https://www.vendr.com/marketplace/grain), range varies).

**Sembly** — the outlier; agentic meeting intelligence for professional services, **no sales scorecard product**, integration-friendly webhooks.

**Takeaways for us — the scoring layer has already tipped from differentiator to table stakes.** As a *data pipe* every tool is a complement; as a *deliverable* our graded scorecard is matched by ≥5 of them. The bundling risk is concrete: Fathom's scorecard is a free checkbox for a customer already on Business tier — we can't win on parity or price. The durable wedges: **(1) cross-recorder normalization** (every scorecard is walled to its own vendor's transcripts; SMB reps sprawl across tools), **(2) opinionated methodology vs. a blank rubric-builder** (H.E.A.R.T. as pre-built product), **(3) cross-tenant benchmarking** (single-tenant by construction for all of them — the one thing no recorder can copy), **(4) manager coaching-workflow depth** (none go deep on 1:1 cadence/calibration/trend-lines). Moats (1) and (3) survive a determined competitor; the rest is out-invest-able (Fathom just posted $30M ARR and is explicitly moving into automation/coaching).

---

## Part 4 — Real-Time Coaching & the Streaming-STT Stack

**Bottom line:** live in-call coaching is a proven, shipping category (Cresta, Balto, Nooks fire genuine mid-call cues), but "real-time" is thinner than marketing suggests outside contact-center-native vendors — **Gong in particular does NOT do live coaching** in the sense Feature (b) wants. The streaming-STT layer is commodity-cheap and sub-second across four vendors; the real blocker is that **Fathom's API is async-only**, so Feature (b) requires a parallel live-capture path, not an extension of the current integration.

### Part A — Real-time / live-coaching products

| Vendor | Live cue types | Focus | List pricing | Real-time maturity | Market |
|---|---|---|---|---|---|
| **Cresta** | Full agent-assist: talk-tracks, objection responses, compliance | Contact center | ~$100–200/agent/mo + platform fee (~$60–150K+/yr) | Highest — core product since ~2018 | Enterprise only (100+ agents) |
| **Balto** | Dynamic scripts, compliance checklists, agent-assist answers | Contact center | Undisclosed (demo-gated) | High — 250M+ calls guided | Mid-market to enterprise |
| **Attention.com** | *Marketed:* live coaching + scorecards; *evidenced:* fast post-call + agentic follow-up | Sales | Undisclosed | **Low-moderate** — "action engine" still being built | SMB to enterprise |
| **Nooks** | AI live battlecards + human whisper-coaching | Sales (outbound/SDR) | ~$5,000/seat/yr | Moderate-high — real triggers, telephony-lag friction | Mid-market to enterprise |
| **Gong** | Talk-ratio alert + tracker alerts (via Zoom app); **NOT** live battlecards | Sales | ~$1,200–1,600+/seat/yr + platform fee | **Low** — functionally a post-call tool | Mid-market to enterprise |

- **Cresta** ($282M raised, $1.6B val 2022) — highest maturity, engineered around end-to-end latency, but contact-center + six-figure + enterprise-only. [cresta.com/agent-assist](https://cresta.com/agent-assist).
- **Balto** ($57.4M raised, ~3,200 customers) — clearest "live prompting" positioning; 250M+ calls guided. [balto.ai](https://www.balto.ai/).
- **Attention.com** ($44M raised, $30M Series B Jun 2026) — boldest marketing, thinnest evidence of true mid-call intervention; the agentic "action engine" is being *funded to build*, not shipped. Sales-focused, SMB-to-enterprise.
- **Nooks** ($70M raised, 1,200+ customers) — genuine AI live battlecards + human whisper, but dialer-bound (Twilio) with reported telephony lag; ~$5K/seat/yr, no self-serve. [nooks.ai/ai-coaching](https://www.nooks.ai/ai-coaching).
- **Gong** — only a live talk-ratio pacing alert + tracker Slack alerts via its Zoom app; **no live battlecard/objection sidebar.** "Gong does not offer real-time coaching—its intelligence is entirely retrospective" ([Balto](https://www.balto.ai/competitors/gong-alternatives/)). Gong Enable's "AI Trainer" is async roleplay, not in-call.

**Implication:** an **SMB-priced, sales-native, real-time cue product is genuinely open** — the players that do it well are contact-center-priced (Cresta/Balto), dialer-bound and expensive (Nooks), unproven (Attention), or wrapped in enterprise forecasting (Clari). This is our Feature (b) opening.

### Part B — Streaming STT + audio-capture stack

| Provider | Streaming price | Diarization | Latency | Notes |
|---|---|---|---|---|
| **Deepgram** (Nova-3/Flux) | $0.0048–0.0078/min ($0.29–0.47/hr) | +$0.002/min | "Sub-300ms"; Flux tuned for turn-taking | [deepgram.com/pricing](https://deepgram.com/pricing) |
| **AssemblyAI** (Universal-Streaming) | $0.15/hr base; Pro Realtime $0.45/hr | +$0.12/hr | ~90ms first word, ~300ms median; **immutable partials** (won't rewrite emitted text) | Billed on **socket-open time**, not audio duration. [assemblyai.com/pricing](https://www.assemblyai.com/pricing) |
| **Gladia** | $0.75/hr Starter; $0.25/hr Growth (commit) | Included | Claimed sub-300ms (~103ms partial in one benchmark) | Diarization bundled — simplest all-in. [gladia.io/pricing](https://www.gladia.io/pricing) |
| **Speechmatics** | ~$0.0117/min (unverified, quote-gated) | Included (up to 50 speakers) | Final <1s (fastest final claim) | Only vendor with air-gapped/on-prem. [speechmatics.com](https://www.speechmatics.com/product/real-time) |
| **OpenAI** (Realtime/transcribe) | gpt-4o-transcribe ~$0.006/min; Realtime is token-priced speech-to-speech | Not native | First-token ~180–300ms | Cheap transcribe models are batch-flavored, not continuous-partials streaming; Realtime is built for two-way voice agents, not a silent listener — neither is the natural fit. |

**Meeting-audio capture:**
- **Recall.ai (bot-as-a-service)** — one integration covers Zoom/Meet/Teams/Webex/Slack Huddles; $0.50/hr bot + $0.15/hr transcription (or BYO STT); real-time audio/transcript via webhook, sub-second. **Best v1 fit.** Caveat: running Recall.ai *alongside* Fathom = two bots in the call unless consolidated. [recall.ai/pricing](https://www.recall.ai/pricing).
- **Zoom RTMS (native)** — invisible, lowest latency, but Zoom-only + 4–6 week app-approval; attractive later if Zoom dominates.
- **Google Meet Media API** — **not viable today**; Developer Preview requiring every participant (incl. external prospects) enrolled in Google's preview program.
- **MS Teams Real-Time Media** — Teams-only, a bespoke C#/.NET Azure-hosted media bot; Microsoft steers most AI use cases away from it.
- **Browser-extension / system-audio capture** — ~$0 marginal, invisible, but fragile (rep must enable tab-audio sharing every call) and captures one mixed channel (degrades diarization). Best as a fallback.

### Feasibility read (Feature b)

**Fathom is a dead end for this feature as-is** — its API is confirmed async-only (transcripts lag "a few minutes," webhook-after-the-fact, no live endpoint). Feature (b) needs a separate live-capture path. Realistic architecture:

```
Meeting (Zoom/Meet/Teams)
   │  [bot joins — Recall.ai for v1]
   ▼
Capture (Recall.ai) ──(raw audio, per-speaker, WS/webhook)──▶ Streaming STT (AssemblyAI/Deepgram)
                                                                     │ partial + diarized deltas
                                                                     ▼
                                          Cue engine (backend)
                                          ├─ deterministic rules (talk-ratio %, silence) — no LLM, ~0 latency
                                          ├─ embedding/keyword match vs H.E.A.R.T. + battlecards — cheap/fast
                                          └─ small fast LLM — ONLY when pre-filters fire, debounced
                                                                     │ cue text + priority
                                                                     ▼
                                          Rep UI (WebSocket → SolidJS frontend)
```

Keep Fathom running unchanged for post-call H.E.A.R.T. grading; the live path is additive.

**Latency budget:** keyword/battlecard cue ~0.5–1.5s; LLM-composed cue ~1–3s (still coaching-useful). **Hardest problems, in order:** (1) multi-platform capture cleanly (Recall.ai is the pragmatic answer); (2) **cue relevance** — knowing *when* a cue is worth interrupting a live human (the industry-wide unsolved problem; ship 2–3 high-confidence triggers first, not all 11); (3) diarization in messy 3+ speaker calls; (4) alert-fatigue UX (debounce + priority-rank, not a firehose); (5) new operational surface (standing WS/bot pipeline vs. batch webhook).

**Rough COGS (per rep-hour of live-coached call, estimate):** Recall.ai bot $0.50 + AssemblyAI streaming+diarization $0.27 + gated LLM ~$0.05–0.20 = **~$0.85–1.00/hr**. The **bot fee, not the AI, is the dominant line item.** Raw COGS (~$1/call-hr) is two orders of magnitude below what the market charges (Cresta $100–200/agent-mo, Nooks ~$417/seat-mo) — **the commercial value is in cue-relevance tuning and rep UX, not the underlying STT/LLM cost, which is commodity.**

---

## Part 5 — ICP, Buyers, Pains & Pricing

### ICP & buyer personas

| Segment | Economic Buyer | Team Size | Job-To-Be-Done |
|---|---|---|---|
| **SMB sales teams** ⭐ | Sales Manager (often still carries a bag) | 2–20 reps (sweet spot 5–15) | "Tell me who needs coaching and on what, every week, without scrubbing recordings — I don't have an enablement team, I *am* the enablement team." |
| **Mid-market** | VP Sales / RevOps / Enablement | 20–100+ reps | "Standardize how all my managers coach so 'good' means the same in every pod; roll scorecards into QBRs." 6–8 stakeholder buying committees. |
| **Founder-led / early-stage** | Founder/CEO | 1–5 | "I've never formally sold — give me a repeatable qualification framework so discovery stops being winged." Time-poor, allergic to enterprise onboarding. |
| **Agencies / fractional coaches** | Agency owner / fractional VP | serve many 2–20-rep teams | "Give me scorecard-backed proof of value across 5–10 clients without listening to hours of calls." A channel/multiplier segment. |
| **Call/BDR centers** | BDR Manager / SDR Director | 10–100+ SDRs | "Score high volumes of short outbound calls for script adherence; feed QA into comp." Already served by Scorebuddy/MaestroQA/Nooks. |

**Sharpest beachhead: SMB sales teams, 5–15 reps, Sales Manager as buyer.** Only segment that transacts self-serve (mid-market wants a demo, BDR centers buy via WFM, agencies need multi-tenant, founder-led rarely pays pre-PMF). Most vocally priced out of Gong ("built for big teams with budgets, not solo founders or small agencies" — [Hyperbound](https://www.hyperbound.ai/blog/gong-alternatives-small-sales-teams)). Sits in a clean gap: below it recorders don't grade, above it Gong/Chorus charge enterprise + platform fees. Least coaching bandwidth per rep → "100% of calls graded automatically" is the highest-leverage promise. The full-cycle consultative H.E.A.R.T. rubric fits the SMB motion (not 30–90s scripted BDR dials). Founder-led is the top-of-funnel feeder (land 1–2 seats, expand to 3–8); agencies are a channel once multi-workspace ships.

### Core pains

- **Rep ramp time:** avg 5.7 months, up 32% since 2020 ([CareerTrainer](https://careertrainer.ai/en/reports/sales-rep-ramp-up-times-statistics/)); good enablement cuts ramp ~17%.
- **Manager review bandwidth — "the coaching void":** widely-repeated (primary source untraceable — directional) stat that 75% of leaders don't listen to calls and those who do review <1% ([scalablebydesign](https://scalablebydesign.substack.com/p/ai-that-coaches-every-sales-call)). A manager of 8 realistically coaches 2–3/week.
- **Subjective, inconsistent coaching:** without a shared rubric "one manager praises a discovery style, another criticizes the same style, neither has data" ([Trellus](https://www.trellus.ai/post/sales-conversation-intelligence)). AI-graded timestamped feedback "lands as guidance rather than opinion."
- **Deal slippage:** avg 27% of forecasted deals slip/quarter; >40% signals inconsistent qualification — what a rubric targets ([Revenue.io](https://www.revenue.io/inside-sales-glossary/what-is-deal-slippage)).
- **Category frustrations (via comparison/procurement sites; G2/TrustRadius returned 403, Reddit unreachable — secondary-sourced):** *price shock* — "surprised by the high upfront platform fees (often $5,000+) before they even pay for seats"; a 15-rep team "nearly $30K/year before onboarding"; renewal "$160→$250/user/month for mandatory bundles" ([Sybill](https://www.sybill.ai/blogs/gong-reviews)). *No trial* — "no monthly billing or short-term trials, even under 25 seats" ([Aviso](https://www.aviso.com/blog/gong-pricing)). *Complexity* — trackers "underutilized because they require dedicated RevOps to configure"; 3–6 month implementation + ~$7,500 onboarding. *What people love (Fathom):* accuracy + fast setup, "AI summaries are a total game changer."

### Pricing patterns

- **Three price bands:** budget recorders w/o coaching ($10–34/seat/mo) → mid-market coaching-capable ($24–90, coaching gated to tier 2) → enterprise RevIntel ($100–250+/seat/mo **plus a platform fee outside the per-seat price**).
- **Consistent gating:** recording/transcription/summaries in base; coaching scorecards/CRM sync/deal intel/analytics at tier 2; forecasting/custom trackers/API/SSO at top.
- **Free-trial vs demo splits by price band:** under ~$40/seat = self-serve w/ free tier; over ~$60 = demo-gated, no public self-serve. Gong is the extreme (no monthly billing, no trial, any size).
- **Annual discount is a category norm** (15–25%).
- **Platform minimums are the sharpest incumbent pain** — Gong's $5K–$50K fee and Chorus's $8K/3-seat base turn "$100/seat" into "$30K/year before onboarding." No sub-enterprise tool charges one.

### Pricing hypothesis (validate before committing)

Structural advantage: BYO-recorder (Fathom webhook) = **no video/audio/transcription infrastructure cost** every competitor carries. This is an LLM-graded coaching *layer*.

| Tier | $/rep/mo (annual) | Monthly | Min seats | Includes |
|---|---|---|---|---|
| **Starter** | $25 | $29 | 1 | Unlimited H.E.A.R.T. grading on existing recordings; per-rep dashboard/trends; weekly Slack digest; 90-day history |
| **Growth** ⭐ | $45 | $55 | 2 | + per-call Slack coaching card; team leaderboard + rep comparison; manager coaching queue (auto-flags lowest scores); CRM sync (HubSpot/Pipedrive); unlimited history |
| **Scale** | $75 | $89 | 2 | + multi-workspace (multi-pod / agencies); custom rubric editor; API + Salesforce; SSO; white-label Slack; benchmarking |

**Each billing choice rebuts a researched pain:** no platform fee ever; month-to-month on every tier; 1–2 seat minimum, self-serve, no mandatory demo; instant setup (existing Fathom webhook); 100% of calls graded; same fixed rubric for every rep/manager; public prices from day one.

**10-rep SMB team, annual:** Gong ~$28–36K · Chorus ~$16.4K · Fathom Business (no scored coaching) ~$3K · **AI Sales Coach Growth $5,400** — full grading + per-call Slack + leaderboard + manager queue, zero platform fee, **~5–6x cheaper than Gong** at a modest premium over a recorder that doesn't coach. Growth lands exactly in the gap: priced like a recorder, capable like an enterprise platform, sold the way the SMB buyer wants to buy.

*Section 5 pricing is an original hypothesis reasoned from the sourced evidence, not researched competitor prices — validate with target buyers.*
