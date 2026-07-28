// Front-end types. Display types (CallRow, Analysis, Evaluation…) are what the UI
// binds to; the API-shaped types below mirror backend/API.md. `lib/api.ts` maps
// one to the other so screens never see raw API shapes.

export type Rating = "Yes" | "Partial" | "No" | "Disqualified";
export type Impact = "Positive" | "Negative" | "Neutral";
/** Backend qualification outcome (H.E.A.R.T.) — NOT a won/lost deal outcome. */
export type Outcome = "qualified" | "disqualified";
export type CallStatus = "analyzed" | "pending" | "failed";

/** The 11 criteria keys, in the fixed rubric order (matches backend). */
export const CRITERIA_ORDER = [
  "call_opening",
  "question_quality_quantity",
  "tension_building",
  "h_high_priority",
  "e_economic_resources",
  "a_authority_to_decide",
  "r_readiness_to_act",
  "t_temperament",
  "objection_prevention_handling",
  "closing_actions",
  "next_steps_follow_up",
] as const;

/** Section groupings used by the scorecard UI, keyed by criterion key. */
export const CRITERIA_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Opening & Discovery", keys: ["call_opening", "question_quality_quantity", "tension_building"] },
  {
    label: "H.E.A.R.T. Qualification",
    keys: ["h_high_priority", "e_economic_resources", "a_authority_to_decide", "r_readiness_to_act", "t_temperament"],
  },
  { label: "Execution & Close", keys: ["objection_prevention_handling", "closing_actions", "next_steps_follow_up"] },
];

export interface TimestampEvent {
  timestamp: string;
  speaker: string;
  quote: string;
  impact: Impact;
  note?: string;
}

export interface Evaluation {
  key: string;
  label: string;
  criterion: string;
  rating: Rating;
  score: number; // weighted: 9.09 full / 6.82 dq / 4.55 partial / 0 fail
  timestamp_events: TimestampEvent[];
  reasoning: string;
}

export interface CriticalMoment {
  timestamp: string;
  type: "Strong Move" | "Missed Opportunity" | "Critical Error";
  description: string;
  affected_criteria: string[];
}

export interface Analysis {
  call_metadata: { call_id: string; advisor_name: string; prospect_name: string; call_duration: string };
  disqualification_summary: {
    was_disqualified: boolean;
    disqualified_criteria: string[];
    disqualification_timestamp: string | null;
    disqualification_reasoning: string | null;
  };
  evaluations: Evaluation[];
  critical_moments: CriticalMoment[];
  summary: {
    total_score: number;
    percentage: number;
    max_possible: number;
    strengths: { strength: string; timestamps: string[] }[];
    areas_for_improvement: { area: string; recommendation: string; timestamps: string[] }[];
    overall_assessment: string;
  };
}

/** Row shape for the calls list / dashboard. */
export interface CallRow {
  id: string;
  title: string;
  advisor: string;
  prospect: string;
  date: string;
  duration: string;
  totalScore: number | null;
  outcome: Outcome | null;
  status: CallStatus;
}

// ---------- API response shapes (backend/API.md) ----------

export interface Me {
  user: { id: string; email: string; name?: string; role: string };
  tenant: { id: string; name: string; slug: string };
}

export interface ApiRep {
  id: string;
  email: string;
  display_name: string | null;
}

export interface ApiCall {
  id: string;
  recording_id: string;
  title: string;
  status: string;
  created_at: string;
  rep: ApiRep | null;
  total_score: number | null;
  outcome: Outcome | null;
  was_disqualified: boolean;
}

export interface CallsPage {
  calls: ApiCall[];
  page: number;
  page_size: number;
  total: number | string; // pg COUNT comes back as a bigint string
}

export interface ApiAnalysis {
  model: string;
  total_score: number;
  outcome: Outcome;
  was_disqualified: boolean;
  created_at: string;
  summary: Analysis["summary"];
  disqualification_summary: Analysis["disqualification_summary"];
  critical_moments: CriticalMoment[];
  criteria: (Omit<Evaluation, "timestamp_events"> & { timestamp_events: TimestampEvent[] })[];
}

export interface CallDetail {
  call: {
    id: string;
    recording_id: string;
    title: string;
    status: string;
    created_at: string;
    rep: ApiRep;
  };
  analysis: ApiAnalysis | null;
}

export interface LeaderboardRep {
  rep_id: string;
  email: string;
  display_name: string | null;
  calls_analyzed: number;
  avg_score: number | null;
  disqualified_count: number;
}

export interface RepTrends {
  rep: ApiRep;
  points: { date: string; avg_score: number; calls: number }[];
  by_criterion: { key: string; label: string; avg_score: number }[];
}

export interface SettingsData {
  call_filter_keyword: string;
  webhook_url: string;
  integrations: {
    fathom: { connected: boolean; webhook_registered: boolean };
    slack: { connected: boolean; enabled?: boolean; channel_id?: string };
  };
}

export interface FathomMeeting {
  recording_id: string;
  title: string;
  recorded_by: string | null;
  created_at: string | null;
  share_url: string | null;
  matches_filter: boolean;
  existing_status: string | null;
}

export interface FathomMeetingsPage {
  keyword: string | null;
  next_cursor: string | null;
  meetings: FathomMeeting[];
}
