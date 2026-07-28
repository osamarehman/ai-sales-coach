import { Show, type JSX, type Resource } from "solid-js";
import { ApiError } from "../lib/api";
import type { Rating, Outcome, CallStatus } from "../lib/types";

/* ---------- Avatar (deterministic initials) ---------- */
export function Avatar(props: { name: string; size?: number }) {
  const initials = () =>
    props.name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const s = () => props.size ?? 28;
  return (
    <span
      class="inline-grid place-items-center rounded-full text-white font-semibold select-none"
      style={{
        width: `${s()}px`, height: `${s()}px`, "font-size": `${Math.round(s() * 0.36)}px`,
        background: "linear-gradient(150deg, var(--accent), var(--accent-strong))",
      }}
      aria-hidden="true"
    >
      {initials()}
    </span>
  );
}

/* ---------- Rating chip (Yes / Partial / No / Disqualified) ---------- */
const ratingClass: Record<Rating, string> = {
  Yes: "chip-yes", Partial: "chip-partial", No: "chip-no", Disqualified: "chip-dq",
};
export function RatingChip(props: { rating: Rating; label?: boolean }) {
  return (
    <span class={`chip ${ratingClass[props.rating]}`}>
      <span class="dot" />
      <Show when={props.label !== false}>{props.rating}</Show>
    </span>
  );
}

/* ---------- Outcome badge (Qualified / Disqualified) ---------- */
const outcomeMeta: Record<Outcome, { cls: string; label: string }> = {
  qualified: { cls: "badge-won", label: "Qualified" },
  disqualified: { cls: "badge-dq", label: "Disqualified" },
};
export function OutcomeBadge(props: { outcome: Outcome }) {
  return <span class={`badge ${outcomeMeta[props.outcome].cls}`}>{outcomeMeta[props.outcome].label}</span>;
}

/* ---------- Status pill (analyzed / pending / failed) ---------- */
export function StatusPill(props: { status: CallStatus }) {
  return (
    <Show when={props.status === "pending"} fallback={
      <Show when={props.status === "failed"} fallback={
        <span class="pill pill-ok"><span class="dot" />Analyzed</span>
      }>
        <span class="pill pill-failed"><span class="dot" />Failed · retry</span>
      </Show>
    }>
      <span class="pill pill-pending"><span class="dot" />Analyzing…</span>
    </Show>
  );
}

/* ---------- Score dial ---------- */
export function ScoreDial(props: { score: number; max?: number; size?: number }) {
  const max = () => props.max ?? 100;
  const pct = () => Math.max(0, Math.min(100, (props.score / max()) * 100));
  const size = () => props.size ?? 108;
  const inner = () => size() - 24;
  return (
    <div
      class="grid place-items-center rounded-full shrink-0"
      style={{
        width: `${size()}px`, height: `${size()}px`,
        background: `conic-gradient(var(--accent) ${pct()}%, var(--line) 0)`,
      }}
      role="img"
      aria-label={`Score ${props.score} of ${max()}`}
    >
      <div class="grid place-items-center rounded-full text-center bg-surface"
        style={{ width: `${inner()}px`, height: `${inner()}px`, "box-shadow": "inset 0 0 0 1px var(--line)" }}>
        <div>
          <b class="text-2xl font-extrabold tracking-tight">{props.score.toFixed(1)}</b>
          <small class="block text-muted" style={{ "font-size": "10.5px" }}>/ {max()}</small>
        </div>
      </div>
    </div>
  );
}

/* ---------- Stat tile ---------- */
export function StatTile(props: { label: string; value: JSX.Element | string; delta?: string; trend?: "up" | "down" }) {
  return (
    <div class="card p-4">
      <div class="text-xs font-semibold text-muted">{props.label}</div>
      <div class="text-[26px] font-bold tracking-tight mt-2 text-ink">{props.value}</div>
      <Show when={props.delta}>
        <div class="text-xs mt-1" classList={{ "text-muted": !props.trend }}
          style={{ color: props.trend === "up" ? "var(--pos-ink)" : props.trend === "down" ? "var(--muted)" : undefined }}>
          <Show when={props.trend}>{props.trend === "up" ? "▲ " : "▼ "}</Show>{props.delta}
        </div>
      </Show>
    </div>
  );
}

/* ---------- Card header ---------- */
export function CardHeader(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="flex items-center gap-2.5 px-[18px] py-3.5 border-b" style={{ "border-color": "var(--line)" }}>
      <h3 class="text-sm font-semibold text-ink">{props.title}</h3>
      <div class="flex-1" />
      {props.children}
    </div>
  );
}

/* ---------- Section label ---------- */
export function GroupLabel(props: { children: JSX.Element }) {
  return <div class="text-[11px] uppercase tracking-[.07em] text-faint font-bold px-[18px] pt-4 pb-2">{props.children}</div>;
}

/* ---------- Async state helpers ---------- */
export function Spinner(props: { label?: string }) {
  return (
    <div class="grid place-items-center py-16 text-muted text-sm gap-3">
      <span class="w-6 h-6 rounded-full animate-spin" style={{ border: "2.5px solid var(--line)", "border-top-color": "var(--accent)" }} />
      <Show when={props.label}>{props.label}</Show>
    </div>
  );
}

export function InlineError(props: { error: unknown }) {
  const msg = () => {
    const e = props.error;
    if (e instanceof ApiError) return e.status === 403 ? "You don't have access to this view." : e.message;
    return "Something went wrong. Please try again.";
  };
  return (
    <div class="card p-6 text-center">
      <p class="text-ink font-semibold">Couldn't load this</p>
      <p class="text-muted text-[13px] mt-1">{msg()}</p>
    </div>
  );
}

export function EmptyState(props: { title: string; hint?: string; children?: JSX.Element }) {
  return (
    <div class="card p-8 text-center">
      <p class="text-ink font-semibold">{props.title}</p>
      <Show when={props.hint}><p class="text-muted text-[13px] mt-1.5 max-w-[46ch] mx-auto">{props.hint}</p></Show>
      <Show when={props.children}><div class="mt-4">{props.children}</div></Show>
    </div>
  );
}

/** Standard loading → error → data boundary around a `createResource`. */
export function AsyncBoundary<T>(props: {
  data: Resource<T>;
  children: (value: T) => JSX.Element;
  loading?: JSX.Element;
}) {
  return (
    <Show when={props.data.error == null} fallback={<InlineError error={props.data.error} />}>
      <Show when={props.data()} fallback={props.loading ?? <Spinner />} keyed>
        {(value) => props.children(value)}
      </Show>
    </Show>
  );
}
