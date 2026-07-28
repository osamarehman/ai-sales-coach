# NEPQ Real-Time Coaching Brain — Research + Design

Scope: the "coaching brain" for a live sales-coaching product. During a live call we have (per the brief):
**dual-channel real-time transcript** (rep = channel R, prospect = channel P, separately diarized) plus computable
**prosody signals**: talk-ratio, monologue length, speaking pace (WPM), pitch/energy proxies (F0, RMS), interruptions/overlap,
and silence/gaps. We surface short on-screen **cues** to the rep, live. This document encodes **Jeremy Miner / 7th Level's
NEPQ** methodology into a machine-detectable cue taxonomy, adds validated conversation-intelligence signals, and specifies
alert-fatigue gating plus a scheduled/queued (stateful) cue model.

> Accuracy note up front: the task brief assumed "three types of tonality (neutral/curious, concerned, playful)." The
> current canonical 7th Level teaching is **FIVE tones — curious, confused, concerned, challenging, playful** (sources in §1.2).
> The brief's three are a subset. I use the accurate five below and flag the mechanically-detectable inflection rule.

---

## 1. NEPQ framework (accurate, sourced)

Jeremy Miner ("Jerry Miner"), founder of **7th Level**, teaches **NEPQ — Neuro-Emotional Persuasion Questioning**. Core thesis:
modern buyers are **skeptical** and pressure-averse; the rep should be a **problem-finder / problem-solver, not a product
pusher**, and use questions so the **prospect persuades themselves**. He frames it as the "scientific method of selling."
Sources: 7th Level "Step-by-Step Breakdown of the NEPQ Process" (https://7thlevelhq.com/a-step-by-step-breakdown-of-the-nepq-sales-process/),
official **NEPQ Framework PDF** (https://7thlevelhq.com/wp-content/uploads/2019/09/NEPQ_Framework-2.pdf),
ippei.com NEPQ review (https://ippei.com/nepq-training/), thed2dexperts.com (https://thed2dexperts.com/blog/jeremy-miner-how-to-make-a-fortune-solving-your-customers-problems/).

### 1.1 Stage flow / question types (the canonical NEPQ structure)

Five macro-stages; the **Engagement** stage contains the five discovery question-types **in order**. This ordering is the
backbone of the coaching brain (coverage + sequencing).

| # | Stage | Question type(s) | Goal |
|---|-------|------------------|------|
| 1 | **Connection** | Connecting Questions | Disarm resistance, build trust, shift from "sales call" to "real conversation." Focus on *them*, off *you*. |
| 2 | **Engagement** | **Situation Questions** | Gather surface facts about their present situation. |
| | | **Problem Awareness Questions** | Open the emotional door: what problems they have, *why* they have them, and *how it's affecting them*. |
| | | **Solution Awareness Questions** | What they've tried before, what worked/didn't, and what their future looks like once solved. |
| | | **Consequence Questions** | Get them to picture what happens if they do nothing — creates urgency to change *now*. |
| | | **Qualifying Questions** | Confirm how important it is to them to change / take action (commitment to solving it). |
| 3 | **Transition** | Transition Questions | Bridge from discovery to the offer ("Would it help if I shared how we…?"). |
| 4 | **Presentation** | (feedback / agreement) | Show how the solution's specifics solve *their* stated problem — only AFTER discovery. |
| 5 | **Commitment** | Commitment Questions | Help them commit and take the next step. |

Sources: official NEPQ Framework PDF (above); NEPQ script/flashcard breakdowns
(https://quizlet.com/793704969/nepq-neural-emotional-persuasion-questions-flash-cards/,
https://quizlet.com/909399274/nepq-jeremy-miner-flash-cards/), Studocu NEPQ Black Book
(https://www.studocu.com/en-us/document/hunter-business-school/macro-economics/the-nepq-black-book-of-questions/122755801).

**Example NEPQ questions (verbatim-style, for the NLP classifier's training seeds):**
- Problem Awareness: "What's causing the problem, do you think?" / "How is that affecting you / the team?"
- Consequence: "Have you thought about what happens if you *don't* do anything about this?" / "What if nothing changes and
  your [cost/result] keeps going the way it's going the next 3, 6, or 12 months?" (7th Level consequence examples).
- Qualifying: "How important is it to you to get this fixed — on a scale…?" / "Is this something you're committed to changing?"
- Commitment: "Where do you feel we should go from here?" (prospect states the next step).

### 1.2 Tonality — the FIVE tones (mechanically important)

Miner teaches that **tone conveys intent** — "your tone is how the prospect interprets your intention behind everything you
say," and *how* you ask matters more than the script. The five tones:

1. **Curious** — genuine interest; the default/most-used tone to get prospects to open up.
2. **Confused** ("Columbo" effect) — softly puzzled, invites them to clarify/correct.
3. **Concerned** — used on Problem-Awareness and Consequence questions; leaning-in, lower, empathetic.
4. **Challenging** — gentle skeptical push to make them defend/strengthen their own reasoning.
5. **Playful** — light, lowers tension, keeps it human.

**The single most machine-detectable tonality rule:** end questions with a **downward inflection** (calm, curious, certain);
an **upward inflection** at the end reads as **needy / salesy / uncertain**. Also: **slow down the second half of the
question** to give them time to think. (Downward = confidence/finality; upward = questioning/insincerity — general
voice-inflection science that matches Miner's teaching.)

Sources: LinkedIn "The 5 types of tones" (https://www.linkedin.com/posts/jeremyleeminer_nepq-salestraining-motivation-activity-7169360763940126720-j0Nr),
TikTok "The 5 tones you need to master" (https://www.tiktok.com/@jeremy_miner/video/7330642987233316142),
YouTube "The 5 Types of Tones" (https://www.youtube.com/shorts/3hz4TQpjycY),
30MPC "Tonality in Sales | Jeremy Miner" (https://open.spotify.com/episode/46bzFnpb8CU16nTsKZf4cp),
thewantrepreneurshow.com (https://www.thewantrepreneurshow.com/blog/how-jeremy-miner-mastered-the-1m-sales-skill-youre-probably-ignoring/),
downward/upward inflection: abstraktmg.com (https://www.abstraktmg.com/from-monotone-to-moving-the-power-of-voice-inflection/).

### 1.3 Core principles

- **The Gap** — the distance between the prospect's **current state** and **desired state**. The **bigger the gap you build
  (via problem-awareness + consequence questions), the more urgency and the *fewer* objections**. Build the gap BEFORE presenting.
- **No sales pressure / detachment** — release attachment to the outcome; pressure triggers resistance in skeptical buyers.
- **Let the prospect persuade themselves** — questions lead them to their own conclusions; you don't argue them into it.
- **Verbal pacing, labels & mirrors** — reflect the prospect's own words back ("mirror") and name their state ("label")
  to deepen disclosure. Mirroring their exact pain word before the next question is a coachable move.
- **Problem finder, not product pusher** — the whole method is discovery-led.

### 1.4 Objection handling — 3-step formula: **Clarify → Discuss → Diffuse**

Instead of "reacting like a robot" with facts/logic, NEPQ handles concerns by:
1. **Clarify** — "When you say ___, what do you mean by that?" (repeat their words back).
2. **Discuss** — talk it through conversationally, "friend to friend"; ask how *they* see themselves resolving it.
3. **Diffuse** — help them dissolve the concern in their own mind.
Source: 7th Level "3-Step Formula for Overcoming Any Objection" (https://7thlevelhq.com/the-3-step-formula-for-overcoming-any-objection/).

### 1.5 Common rep MISTAKES Miner coaches against (these become negative-trigger cues)

- **Pitching / presenting too early** — before problem awareness and before the gap exists.
- **Talking too much** — product-pushing, dominating the airtime.
- **Getting defensive on objections** — answering immediately with facts/logic instead of clarifying.
- **Weak or leading questions** — questions that don't create emotion or that telegraph the "right" answer.
- **No problem awareness / consequence before presenting** — presenting into a vacuum.
- **Needy tone** — upward inflection, fast pace, "commission breath."

---

## 2. Signal layer (what the brain computes each tick)

The cue taxonomy sits on two signal families. **Design the brain as: raw signals → derived signals/flags → cue triggers →
gating → surface.**

**A. Prosody / timing signals (given):**
- `rep_talk_ratio(window)` — rolling (e.g., last 3 min) and cumulative.
- `current_monologue_sec(speaker)` — duration of the current uninterrupted turn.
- `pace_wpm(speaker, window)` — words/min.
- `f0_terminal_slope(utterance)` — pitch trend over the last ~0.5–1s of a rep question (down vs up); `energy_rms`.
- `interruption_event` — R starts speaking while P is mid-utterance (excluding short backchannels "yeah/right").
- `silence_gap_sec` — gap after a speaker stops.

**B. NLP-derived signals (near-real-time over the accumulating transcript):**
- `is_question(utterance)` + `time_since_last_rep_question`, `rep_question_count`.
- **NEPQ stage/type classifier** → tags each rep question as Connection / Situation / ProblemAwareness / SolutionAwareness /
  Consequence / Qualifying / Transition / Commitment. Maintains per-call **coverage flags** (count per stage).
- `pain_signal(P)` — prospect emitted a problem/emotion word ("frustrated," "struggling," "issue," "hate," "too expensive,"
  "not working," "behind," "losing," "wish we could…").
- `objection_intent(P)` — "too expensive," "need to think about it," "talk to my spouse/partner," "not interested," "send me
  info," "already have a vendor."
- `buying_signal(P)` — "how do we get started," "what's the price," "when could you…," positive commitment language.
- `is_presenting(R)` — rep is describing product features/benefits/pricing (marks entry to Presentation).
- `mirror_used(R)` — rep repeated the prospect's key words within N seconds.
- `filler_rate(R)` — um/uh/like/you-know per minute.
- `mentions_budget/authority/timeline(P)` — for qualifying + scheduled goals.

---

## 3. Cue taxonomy (NEPQ-grounded + validated CI signals)

Priority tiers:
- **Critical** — actively damaging the deal *right now*; correct immediately.
- **Helpful** — a clear NEPQ opportunity to seize.
- **FYI** — soft ambient nudge; low urgency, easily suppressed.

Source column: **NEPQ** = Miner-specific; **CI** = general conversation-intelligence best practice (Gong/Chorus/Cresta);
**Both** = validated CI signal that NEPQ also teaches.

| # | Cue name | Live trigger condition (detectable) | On-screen text (imperative, ≤6 words) | Tier | Src |
|---|----------|-------------------------------------|----------------------------------------|------|-----|
| 1 | Talk-ratio drift | `rep_talk_ratio(3min) > 65%` sustained ≥30s (discovery phase) | "You're talking too much — ask" | FYI | Both |
| 2 | Talk-ratio critical | `rep_talk_ratio(5min) > 75%` in discovery | "Stop pitching — let them talk" | Critical | Both |
| 3 | Monologue too long | `current_monologue_sec(R) > 75–90s` with no question in it | "90 seconds — stop, ask a question" | Critical | Both |
| 4 | Prospect not opening up | at 10-min mark, `longest_prospect_story < 20s` OR `prospect_talk_ratio < 30%` | "Get them talking — go deeper" | Helpful | Both |
| 5 | Question drought | `time_since_last_rep_question > 90s` in discovery | "Ask a question" | Helpful | Both |
| 6 | Weak/leading question | classifier flags closed/leading question streak (≥3) | "Ask an open, curious question" | FYI | NEPQ |
| 7 | No Connection yet | rep asked a Situation/business question first, `connection_count = 0` in first 2:00 | "Connect first — ease in" | Helpful | NEPQ |
| 8 | No Problem-Awareness | `problem_awareness_count = 0` at minute 6 (deadline) | "Find the problem — what's not working?" | Critical | NEPQ |
| 9 | Missed pain signal | `pain_signal(P)` fired AND rep's next turn changed topic / started presenting | "They named a problem — dig in" | Critical | NEPQ |
| 10 | Pitching too early | `is_presenting(R)` becomes true while `problem_awareness_count = 0` OR `consequence_count = 0` | "Too early — build the gap first" | Critical | NEPQ |
| 11 | No Consequence before pitch | rep enters Transition/Presentation with `consequence_count = 0` | "Ask a consequence question first" | Critical | NEPQ |
| 12 | Consequence prompt (deadline) | `consequence_count = 0` at minute 8 AND problem awareness exists | "Ask: what if nothing changes?" | Helpful | NEPQ |
| 13 | Mirror the pain | `pain_signal(P)` fired AND `mirror_used = false` in rep's reply | "Mirror their last words" | Helpful | NEPQ |
| 14 | Needy tone / upward inflection | `f0_terminal_slope > 0` (rising) + high `energy_rms` on rep questions, ≥2 in 60s | "Drop your tone — calm & curious" | Helpful | NEPQ |
| 15 | Pace too fast | `pace_wpm(R) > 165` sustained ≥20s | "Slow down — slow the 2nd half" | FYI | Both |
| 16 | Filler-word spike | `filler_rate(R) > 6/min` | "Fewer filler words" | FYI | CI |
| 17 | Interrupting prospect | `interruption_event` count ≥2 in 3 min (esp. during a pain story) | "Let them finish" | Critical | Both |
| 18 | Impatient / no silence | rep starts speaking `< 0.7s` after prospect stops, repeatedly | "Pause — let silence work" | FYI | Both |
| 19 | Objection — clarify first | `objection_intent(P)` detected | "Clarify: 'what do you mean by that?'" | Critical | NEPQ |
| 20 | Defensive on objection | after objection, rep turn is long (>15s) feature/logic rebuttal, no clarifying question | "Don't defend — ask, then diffuse" | Critical | NEPQ |
| 21 | No Qualifying before close | Transition/Commitment question with `qualifying_count = 0` | "Qualify: how important is fixing this?" | Helpful | NEPQ |
| 22 | Buying signal — advance | `buying_signal(P)` detected AND rep keeps presenting | "They're ready — ask for the next step" | Helpful | Both |
| 23 | Missing next-step (end) | in last 5 min of scheduled length, `commitment_count = 0` | "Lock the next step" | Critical | Both |

Coverage check against the brief's required categories: talk-to-listen (1,2), longest monologue (3), question density/rate
(5,6), discovery-coverage gaps by stage (7,8,10,11,12,21), filler/pace (15,16), interruptions (17,18), objection-handling
(19,20), tonality drift (14), commitment/next-step (22,23), plus prospect-engagement (4), mirror/label (13), patience (18).

---

## 4. Alert-fatigue gating (THE adoption killer — concrete defaults)

Evidence: frequent notifications raise cognitive load ~**37%** and cut task efficiency ~**28%**; **>10 notifications/hour**
drives disengagement with response rates dropping ~**52%**; if most alerts are ignorable, people stop reading *all* of them.
Cresta reports **65%** of agents *want* real-time hints and that personalized coaching is **~3x** more effective than
one-size-fits-all — i.e., relevance, not volume, drives adoption. Sources: suprsend.com/post/alert-fatigue,
magicbell.com/blog/alert-fatigue, rootly.com/on-call-software/alert-fatigue, cresta.com/agent-assist.

**The gate — every candidate cue passes ALL of these before it can display:**

1. **Confidence threshold (per tier).** Fire only if trigger confidence ≥ **Critical 0.75 / Helpful 0.80 / FYI 0.85**.
   (Higher bar for lower-value cues; a false FYI is pure noise.)
2. **Sustained/debounced conditions.** Metric-based triggers must hold for a **min window** before firing, not a spike:
   talk-ratio ≥ **30s**, pace ≥ **20s**, monologue is inherently durational. Rejects flicker.
3. **One cue on screen at a time.** Never stack. Display duration **6–8s**, then auto-dismiss.
4. **Global rate limit.** Soft target **≤ 1 cue / 2 min** (~≤15/hr, safely under the 10/hr-disengagement zone on average);
   **hard cap 2 cues/min** for genuine bursts. Budget ≈ **8–12 cues per 30-min call**.
5. **Minimum inter-cue quiet gap.** ≥ **20s** between *any* two cues (breathing room), tier regardless.
6. **Per-cue cooldown (debounce).** Same cue type can't re-fire for: talk-ratio **3 min**, monologue **90s after dismiss**,
   pace/filler **2 min**, tonality **90s**; event cues (objection, buying signal) cooldown **per distinct event**.
7. **Priority pre-emption.** A **Critical** cue may replace a displayed Helpful/FYI immediately; Helpful/FYI **cannot**
   pre-empt anything; equal-tier collisions **queue** (see §5), newest waits.
8. **Turn-boundary backpressure.** Hold **non-critical** cues until the rep hits a turn boundary/short silence — don't
   distract mid-sentence. **Critical** cues fire immediately regardless.
9. **Warm-up grace.** No **non-critical** cues in the first **60–90s** (let them connect).
10. **Acknowledgment suppression / self-heal.** If the rep corrects the behavior (asks a question after a monologue cue,
    clarifies after an objection cue), **clear and reset** the trigger — don't nag a fixed problem.
11. **End-of-call priority reserve.** In the final 5 min, reserve capacity for the **next-step** cue (#23) — it can always fire.

Net effect: FYIs rarely reach the screen; Criticals almost always do; the rep sees a calm stream of ~1 relevant nudge every
couple of minutes, not a firehose.

---

## 5. Scheduled / queued cue model (stateful per-call GOALS)

Time-based and event-watch coaching intents are represented as **Goals** — small fire-once state machines that run
server-side in a **per-call session** (an actor/loop ticking every ~1–2s over the accumulating transcript + latest signal
snapshot + stage-coverage flags). When a Goal fires, it emits a candidate cue **into the same §4 gating pipeline** (so
scheduled cues still respect one-at-a-time, priority, and rate limits). The gating pipeline's "queue" and the Goal engine are
the two halves of this: Goals decide *whether/when* a cue is warranted; gating decides *whether it reaches the screen now*.

### 5.1 Goal object

```
Goal {
  id
  label
  type:  "deadline" | "watch" | "window" | "guard"
  arm:   time (call-clock, e.g. 0:00 / event, e.g. is_presenting=true)
  disarm:time | event | null
  condition: predicate(state)        // evaluated each tick while ARMED
  satisfiedBy: predicate(state)      // if true → CANCELLED (goal already met, don't nag)
  action: { cueText, tier }
  fireOnce: true
  cooldown / maxFires: (usually 1)
  state: PENDING → ARMED → (FIRED | SATISFIED/CANCELLED | EXPIRED)
}
```

**Semantics by type:**
- **deadline** — fires the action **if the target behavior has NOT happened by a time**. `condition = target NOT yet
  observed`; evaluated at `arm=deadline`. If observed earlier → `satisfiedBy` cancels it. (e.g., "consequence by min 8".)
- **watch** — fires **when a target event is observed** within an active window. `condition = event observed`. (e.g., "budget
  mentioned → cue.") Fire-once.
- **window** — action is only *eligible* within `[arm,disarm]` (e.g., last 5 min). Usually combined with deadline/watch.
- **guard** — armed by a **sequence violation event** (rep did X out of order). `arm = is_presenting=true`, `condition =
  prerequisite stage count == 0`. (e.g., "presenting before consequence".)

Lifecycle: `PENDING` until `arm` → `ARMED` (tick-evaluate `satisfiedBy` first, then `condition`) → on `condition` true emit
cue + `FIRED`; on `satisfiedBy` true → `CANCELLED`; on `disarm`/window-close without firing → `EXPIRED`.

### 5.2 Example goals (drop-in defaults)

| Goal | Type | Arm → Condition (fires when) | Satisfied/cancel if | Cue text | Tier |
|------|------|------------------------------|----------------------|----------|------|
| G1 Connect-first | guard | first rep Situation/business Q & `connection_count=0` in 0:00–2:00 | any connection question asked | "Connect first — ease in" | Helpful |
| G2 Problem-awareness by 6:00 | deadline | at 6:00, `problem_awareness_count=0` | a PA question asked before 6:00 | "Find the problem — what's not working?" | Critical |
| G3 Consequence before pitch | guard | `is_presenting=true` & `consequence_count=0` | consequence asked first | "Ask a consequence question first" | Critical |
| G4 Consequence by 8:00 | deadline | at 8:00, `consequence_count=0` & PA exists | consequence asked before 8:00 | "Ask: what if nothing changes?" | Helpful |
| G5 Budget watch | watch | any time `mentions_budget(P)=true` | — (fire-once) | "Budget's up — ask how they got that number" | Helpful |
| G6 Incumbent/competitor watch | watch | prospect names current vendor ("we already use X") | — | "Ask what's missing with their current setup" | Helpful |
| G7 Confirm next steps (last 5 min) | window+deadline | in final 5:00, `commitment_count=0` | commitment/next-step asked | "Lock the next step before you hang up" | Critical |
| G8 Qualify before transition | guard | Transition/Commitment Q issued & `qualifying_count=0` | a qualifying question asked | "Qualify: how important is fixing this?" | Helpful |

Goals G1–G4, G7–G8 are **NEPQ sequencing/coverage** logic; G5–G6 are **event watches** the product owner can author per
playbook. New goals are just data (arm/condition/action/tier) — the same engine runs them, so admins can add "watch for a
compliance phrase," "if no ROI question by min 12," etc. without code.

---

## 6. Sources

NEPQ / Jeremy Miner:
- 7th Level — Step-by-Step Breakdown of the NEPQ Process: https://7thlevelhq.com/a-step-by-step-breakdown-of-the-nepq-sales-process/
- 7th Level — official NEPQ Framework (PDF): https://7thlevelhq.com/wp-content/uploads/2019/09/NEPQ_Framework-2.pdf
- 7th Level — 3-Step Formula for Overcoming Any Objection: https://7thlevelhq.com/the-3-step-formula-for-overcoming-any-objection/
- 7th Level HQ (home / NEPQ 3.0): https://7thlevelhq.com/ , https://7thlevelhq.com/nepq-3-0/
- NEPQ review (question types, stages): https://ippei.com/nepq-training/
- NEPQ flashcards / script: https://quizlet.com/793704969/nepq-neural-emotional-persuasion-questions-flash-cards/ , https://quizlet.com/909399274/nepq-jeremy-miner-flash-cards/
- NEPQ Black Book (Studocu): https://www.studocu.com/en-us/document/hunter-business-school/macro-economics/the-nepq-black-book-of-questions/122755801
- "The gap" / problem-finder: https://thed2dexperts.com/blog/jeremy-miner-how-to-make-a-fortune-solving-your-customers-problems/

Tonality (five tones + inflection):
- LinkedIn "5 types of tones": https://www.linkedin.com/posts/jeremyleeminer_nepq-salestraining-motivation-activity-7169360763940126720-j0Nr
- TikTok "5 tones you need to master": https://www.tiktok.com/@jeremy_miner/video/7330642987233316142
- YouTube "The 5 Types of Tones": https://www.youtube.com/shorts/3hz4TQpjycY
- 30MPC "Tonality in Sales | Jeremy Miner": https://open.spotify.com/episode/46bzFnpb8CU16nTsKZf4cp
- Wantrepreneur (tone = intent): https://www.thewantrepreneurshow.com/blog/how-jeremy-miner-mastered-the-1m-sales-skill-youre-probably-ignoring/
- Downward vs upward inflection: https://www.abstraktmg.com/from-monotone-to-moving-the-power-of-voice-inflection/

Conversation-intelligence benchmarks (Gong / Chorus / Cresta / Balto):
- Gong talk-to-listen (43:57): https://www.gong.io/blog/talk-to-listen-conversion-ratio , https://www.gong.io/resources/labs/talk-to-listen-conversion-ratio/
- Gong winning conversations (question counts): https://www.gong.io/blog/winning-sales-conversations
- 43:57 benchmark / discovery: https://www.numigtm.com/blog/talk-to-listen-ratio-sales , https://www.grademyclose.com/blog/ideal-talk-ratio-for-sales-calls , https://www.hyperbound.ai/blog/talk-listen-ratio-sales-deals
- Longest monologue (76s / 90s rule, 11–14 questions): https://support.atriumhq.com/hc/en-us/articles/4403301211277-Gong-Longest-Monologue , https://www.coffee.ai/articles/analyze-sales-calls-in-gong
- Gong interruptions / patience metrics: https://help.gong.io/docs/analyze-team-performance
- Cresta agent assist (sub-200ms, 65% want hints, 3x personalized): https://cresta.com/agent-assist
- Balto real-time guidance: https://www.balto.ai/

Alert fatigue / notification design:
- Cognitive load +37%, >10/hr disengagement, 52% drop: https://www.suprsend.com/post/alert-fatigue
- Notification fatigue design: https://www.magicbell.com/blog/alert-fatigue , https://rootly.com/on-call-software/alert-fatigue , https://www.checklyhq.com/blog/alert-fatigue/
- Real-time coaching alerts: https://insight7.io/how-to-set-up-alerts-for-coaching-based-on-real-time-events/
