# AI Sales Coach — Backend API

Base URL (dev): `http://localhost:8090`. All responses are JSON.

## Auth (BetterAuth, cookie sessions)
Auth is cookie-based — the browser stores an **httpOnly** session cookie; send
`credentials: "include"` on every fetch. Never read a user id/role from the client;
the server derives them from the session.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/sign-up/email` | `{ name, email, password }` | Creates user + auto-provisions their tenant (owner). Auto signs in. |
| POST | `/api/auth/sign-in/email` | `{ email, password }` | Sets session cookie. |
| POST | `/api/auth/sign-out` | — | Invalidates the session server-side. |
| GET | `/api/auth/get-session` | — | BetterAuth's raw session (or null). |

On `401` from any endpoint below, redirect to the login screen.

## App endpoints (require a session)

### `GET /api/me`
```json
{ "user": { "id": "…", "email": "a@x.com", "role": "owner" },
  "tenant": { "id": "uuid", "name": "Alice's Workspace", "slug": "alice-8cbff7" } }
```

### `GET /api/settings` · `PUT /api/settings` · integrations
```json
// GET
{ "call_filter_keyword": "GAMEPLAN",
  "webhook_url": "http://…/api/webhooks/fathom/<tenantToken>",
  "integrations": {
    "fathom": { "connected": true },
    "slack":  { "connected": true, "enabled": true, "channel_id": "C0962S41ZDG" } } }
```
- `PUT /api/settings` body `{ "call_filter_keyword": "GAMEPLAN" }` (empty string = analyze all calls).
- `POST /api/settings/integrations/fathom` body `{ "apiKey": "…" }` → `{ ok, connected }`. Encrypted at rest.
- `POST /api/settings/integrations/slack` body `{ "botToken": "xoxb-…", "channelId": "C…" }` → `{ ok, connected, enabled, channel_id }`. On each completed analysis, posts the headline to the channel + the 11-criteria breakdown in its thread (rendered from stored JSON).
- `PUT /api/settings/integrations/slack` body `{ "enabled"?: boolean, "channelId"?: string }` → toggle/retarget. `404` if Slack not connected.

### `GET /api/calls`
Query: `rep` (uuid), `status`, `outcome` (`qualified|disqualified`), `from`/`to`
(ISO datetime), `page` (default 1), `page_size` (default 25, max 100).
Managers (owner/admin) see all reps; members see only their own calls.
```json
{ "calls": [
    { "id": "uuid", "recording_id": "demo-1", "title": "Acme — GAMEPLAN",
      "status": "analyzed", "created_at": "2026-07-23T…Z",
      "rep": { "id": "uuid", "email": "rep.one@demo.com", "display_name": "Riley One" },
      "total_score": 90.91, "outcome": "qualified", "was_disqualified": false } ],
  "page": 1, "page_size": 25, "total": 3 }
```
`status` ∈ `received|skipped|fetching|analyzing|analyzed|failed`.

### `GET /api/calls/:id`
```json
{ "call": { "id": "uuid", "recording_id": "demo-1", "title": "…", "status": "analyzed",
            "created_at": "…", "rep": { "id": "uuid", "email": "…", "display_name": "…" } },
  "analysis": {
    "model": "anthropic/claude-sonnet-4.5", "total_score": 90.91,
    "outcome": "qualified", "was_disqualified": false, "created_at": "…",
    "summary": { "total_score": 90.91, "percentage": 90.91, "max_possible": 100,
                 "strengths": [ … ], "areas_for_improvement": [ … ], "overall_assessment": "…" },
    "disqualification_summary": { "was_disqualified": false, "disqualified_criteria": [], … },
    "critical_moments": [ { "timestamp": "00:00:46", "type": "Strong Move", "description": "…", "affected_criteria": [ … ] } ],
    "criteria": [
      { "key": "call_opening", "label": "Call Opening", "criterion": "Call Opening",
        "rating": "Yes", "score": 9.09, "reasoning": "…",
        "timestamp_events": [ { "timestamp": "00:00:20", "speaker": "Alex", "quote": "…", "impact": "Positive", "note": "…" } ] },
      … 11 total, fixed order …
    ] } }
```
`analysis` is `null` if the call has not been analyzed yet (`status` ≠ `analyzed`).
The 11 `criteria` keys, in order: `call_opening`, `question_quality_quantity`,
`tension_building`, `h_high_priority`, `e_economic_resources`, `a_authority_to_decide`,
`r_readiness_to_act`, `t_temperament`, `objection_prevention_handling`,
`closing_actions`, `next_steps_follow_up`. Ratings: `Yes` 9.09 / `Partial` 4.55 /
`No` 0 / `Disqualified` 6.82 (HEART only). Max total ≈ 100.

### `GET /api/leaderboard` (managers only; `403` for members)
```json
{ "reps": [ { "rep_id": "uuid", "email": "rep.one@demo.com", "display_name": "Riley One",
              "calls_analyzed": 2, "avg_score": 82.95, "disqualified_count": 1 } ] }
```

### `GET /api/reps/:id/trends` (members: only their own)
```json
{ "rep": { "id": "uuid", "email": "…", "display_name": "…" },
  "points": [ { "date": "2026-07-23", "avg_score": 86.36, "calls": 2 } ],
  "by_criterion": [ { "key": "call_opening", "label": "Call Opening", "avg_score": 9.09 }, … ] }
```

## Errors
`400` invalid input (`{ error, details? }`) · `401` no session · `403` forbidden
(role) · `404` not found / cross-tenant · `500` internal. Never contains stack traces.
