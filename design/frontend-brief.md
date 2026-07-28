# AI Sales Coach — Front-End Design Brief

Input package for **Cloud Design** (claude.ai/design). Scope of this pass: **low-fi
wireframes only** — layout, hierarchy, and content, not final visual styling. Screens
are later hand-built in **SolidJS + Tailwind**, so every layout must map cleanly to
composable components (no effects that depend on a heavy design tool).

---

## 1. Product in one line
Buyers sign up, connect their **Fathom** call recorder, and every sales call is
auto-graded by an LLM against an **11-criteria H.E.A.R.T. rubric** and surfaced as a
**scorecard** in a dashboard. Multi-tenant SaaS; Slack is an optional side channel.

## 2. Who uses it (drives what each screen shows)
| Role | Sees | Can do |
|---|---|---|
| **Sales rep / advisor** | Only their *own* scored calls + personal trend | Read scorecards, filter own calls |
| **Manager / admin** (org owner) | *All* reps in their org, team leaderboard | Everything a rep can + connect integrations, manage team, settings |
| **Platform owner** (us) | Operates one deployment; not a product persona | — |

Role gating is real, not cosmetic: a rep must never see another rep's calls. Wireframes
should show the **manager view** (superset) and note which blocks are manager-only.

## 3. Design direction — **Modern SaaS analytics** (chosen 2026-07-23)
Target feel: product-y and confident, in the lineage of **Linear / Vercel / Height** —
data-dense but composed, with just enough polish to feel premium.
- **Grid-first, tight data cards.** Strict column grid, but cards sit closer together than
  pure Swiss whitespace — this is a working dashboard, not a landing page.
- **Typography-led hierarchy.** One strong sans (Inter / Geist). Size + weight carry
  structure; numbers are the hero and get the boldest treatment.
- **Neutral canvas + one confident accent.** Near-white / near-black surfaces, a single
  brand accent used deliberately (primary actions, active nav, key metrics), plus a small
  **semantic set** the data demands (see §7): positive / partial / negative / disqualified /
  outcome states. Optional very-subtle gradient on hero/score surfaces — restraint over flash.
- **Quiet, layered chrome.** Hairline borders + soft, low-spread shadows for elevation
  (cards, popovers). `rounded-lg` on cards, `rounded-md` on controls. Avoid pill-everything.
- **Data is the hero.** Tables, score dials, chips, sparklines read at a glance; motion is
  minimal and purposeful (hover, expand, skeleton→content).
- **Light + dark** as first-class from the start.

*Wireframes stay grayscale — this section is the north star for the follow-up visual pass.*

## 4. Information architecture / navigation
Persistent **left sidebar** (collapsible) + top bar (org switcher not needed — one org per session, but show org name + user menu).

```
App shell
├─ Dashboard            (overview / KPIs)
├─ Calls                (list → scorecard detail)
├─ Team                 (manager only: reps + leaderboard)
├─ Trends              (analytics: score over time, per-criterion)
└─ Settings
   ├─ Integrations      (Fathom, Slack)
   ├─ Team & members    (manager only: invite, roles)
   └─ Account           (profile, password)
```
Auth + onboarding live **outside** the shell (centered, no sidebar).

## 5. Screen inventory
Each screen: purpose · key content · states to draw · primary actions.

### A. Auth (outside shell, centered card)
1. **Sign up** — email, password, org name. *Creates tenant + owner user.* → onboarding.
2. **Log in** — email, password, "forgot".
3. States: default, inline validation error, loading/submitting.

### B. Onboarding wizard (first run after signup) — 3 steps, progress indicator
1. **Connect Fathom** — paste API key, explainer of what we do with it. Show the
   tenant's unique **webhook URL** to paste into Fathom + which trigger events to enable.
2. **Call filter** — keyword that decides which calls get analyzed (default `GAMEPLAN`).
3. **Done / waiting** — "We'll grade calls as they come in." Links to dashboard (empty state).

### C. Dashboard (landing after login)
- **KPI tiles row:** calls analyzed (this period), avg total score, outcome split
  (won / lost / disqualified), score trend vs last period.
- **Recent calls** — compact list (last 5–10), each: prospect, advisor, date, score, outcome badge.
- **Top improvement areas** — aggregated across team (manager) or self (rep): which of
  the 11 criteria score lowest.
- **States:** populated · **empty** (post-onboarding, no calls yet — the important one) ·
  loading skeletons.

### D. Calls list
- **Filter bar:** rep (manager only), date range, outcome (won/lost/disqualified),
  status (analyzed / pending / failed).
- **Table:** prospect · advisor · date · duration · total score · outcome badge · status.
  Rows are clickable → scorecard. Sort by date/score. Pagination.
- **States:** rows · empty (no matches) · a **pending** row (analysis in progress) · loading.

### E. Call scorecard — **the hero screen** (see §6 for the data)
- **Header block:** advisor ↔ prospect, date, duration, **big total score / 100**,
  **outcome badge** (Won / Lost / Disqualified). If disqualified → prominent
  **disqualification banner** (which H.E.A.R.T. criterion, timestamp, reasoning).
- **Overall assessment** — 2–4 sentence coaching summary.
- **Score breakdown** — the **11 criteria** in fixed order, grouped into 3 sections:
  - *Opening & Discovery:* Call Opening · Question Quality/Quantity · Tension-Building
  - *H.E.A.R.T. Qualification:* High Priority · Economic Resources · Authority to Decide · Readiness to Act · Temperament
  - *Execution & Close:* Objection Prevention/Handling · Closing Actions · Next Steps/Follow-Up
  - Each criterion card: **rating chip** (Yes / Partial / No / Disqualified), **score**,
    **reasoning** paragraph, and expandable **timestamped quote events** (timestamp ·
    speaker · quote · positive/negative/neutral impact).
- **Critical moments** — timeline/list of key moments (Strong Move / Missed Opportunity /
  Critical Error) with timestamp + affected criteria.
- **Strengths** and **Areas for improvement** (each with recommendation + timestamps).
- **Call phases** strip (optional): opening / discovery / presentation / closing ranges.
- **States:** full scorecard · **analysis pending** (call captured, grading running) ·
  **analysis failed** (retry) · disqualified variant.

### F. Trends / analytics
- **Score over time** — line chart (a rep's avg, or team avg for manager).
- **Per-criterion breakdown** — which criteria are consistently strong/weak (bar or radar).
- **Leaderboard** (manager only) — reps ranked by avg score, call count, trend arrow.
- **States:** enough data · not-enough-data (needs N calls).

### G. Team (manager only)
- List of reps: name, avg score, calls analyzed, last activity, trend. Row → that rep's
  filtered calls/trends.

### H. Settings
1. **Integrations**
   - *Fathom:* connection status, re-paste/rotate key, **webhook URL** (copyable), call-filter keyword.
   - *Slack:* connect (bot token), pick channel, **on/off toggle** for posting scorecards.
2. **Team & members** (manager): invite by email, assign role (rep/manager), remove.
3. **Account:** name, email, change password, sign out.
- **States:** connected vs not-connected for each integration; secrets shown as masked/"•••• set".

## 6. Data the scorecard renders (real output contract)
The LLM returns one JSON object per call. Fields the UI binds to:
- `call_metadata`: `advisor_name`, `prospect_name`, `call_duration`, `call_id`
- `summary`: `total_score` (0–100), `percentage`, `overall_assessment`, `strengths[]`
  (`strength`, `timestamps[]`), `areas_for_improvement[]` (`area`, `recommendation`, `timestamps[]`)
- `evaluations[11]` (fixed order): `criterion`, `rating` (`Yes|Partial|No|Disqualified`),
  `score` (weighted float — 9.09 full / 6.82 disqualified / 4.55 partial / 0 fail),
  `reasoning`, `timestamp_events[]` (`timestamp`, `speaker`, `quote`, `impact`, `note`)
- `disqualification_summary`: `was_disqualified`, `disqualified_criteria[]`,
  `disqualification_timestamp`, `disqualification_reasoning`
- `critical_moments[]`: `timestamp`, `type` (Strong Move / Missed Opportunity / Critical Error),
  `description`, `affected_criteria[]`
- `timestamp_analysis`: opening / discovery / presentation / closing / disqualification phase ranges

Max score 100 (11 × 9.09). Only the 5 H.E.A.R.T. criteria can be `Disqualified`; one
disqualified H.E.A.R.T. criterion disqualifies the whole call.

## 7. Component inventory (design-system atoms to wireframe once, reuse everywhere)
- **App shell:** sidebar nav (item, active, collapsed), top bar, user menu, org label.
- **Buttons:** primary / secondary / ghost / destructive; icon button.
- **Inputs:** text, password, select, date-range, toggle/switch, copy-to-clipboard field
  (for webhook URL / secrets).
- **Rating chip** — `Yes` / `Partial` / `No` / `Disqualified` (4 semantic colors).
- **Outcome badge** — `Won` / `Lost` / `Disqualified`.
- **Status pill** — `Analyzed` / `Pending` / `Failed`.
- **Score display** — large total (dial or big-number), and inline per-criterion score.
- **KPI stat tile** — label, value, delta vs previous.
- **Criterion card** — chip + score + reasoning + expandable quote-events list.
- **Quote-event row** — timestamp · speaker · quote · impact marker.
- **Data table** — sortable header, clickable row, pagination, empty row.
- **Filter bar** — chips/selects that combine.
- **Timeline / phase strip** — for critical moments + call phases.
- **Charts** — line (trend), bar/radar (per-criterion). *(Wireframe as placeholder blocks.)*
- **Feedback:** empty state, loading skeleton, error state, toast, confirm modal.
- **Wizard** — step header + progress + back/next.

## 8. Responsive
Desktop-first (analysts on laptops), but must degrade: sidebar collapses to icons then to
a top drawer on mobile; tables become stacked cards; scorecard criteria stack single-column.

## 9. Wireframe pass — what to draw (priority order)
1. **Call scorecard** (E) — highest value, most complex, defines the data language.
2. **Calls list** (D) + **Dashboard** (C).
3. **Onboarding wizard** (B) + **Settings › Integrations** (H1).
4. **Trends** (F) + **Team** (G).
5. **Auth** (A).
Draw the **empty**, **loading**, and **pending/disqualified** states for C, D, and E —
they're where this product lives or dies.

## 10. Out of scope for the wireframe pass
Final color/type, per-tenant rubric editing (deferred M8), billing, multi-recorder,
the second "Slack presentation" LLM. Slack shows only as a connect/toggle in Settings.
