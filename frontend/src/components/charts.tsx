// Lightweight, dependency-free SVG charts. Theme-aware (colors come from CSS
// vars), responsive (measured with ResizeObserver so strokes/dots never distort).

import { createSignal, onCleanup, onMount, For, Show, type JSX } from "solid-js";

/** Track an element's pixel width so SVGs render at true, undistorted scale. */
function useWidth() {
  const [width, setWidth] = createSignal(0);
  let el: HTMLDivElement | undefined;
  onMount(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    onCleanup(() => ro.disconnect());
  });
  return { setRef: (e: HTMLDivElement) => (el = e), width };
}

export interface LinePoint { label: string; value: number; meta?: string }

/** Score-over-time line with soft area fill and value dots. */
export function LineChart(props: { points: LinePoint[]; max?: number; height?: number }) {
  const { setRef, width } = useWidth();
  const max = () => props.max ?? 100;
  const h = () => props.height ?? 150;
  const padY = 12;
  const padX = 8;

  const geom = () => {
    const w = width();
    const pts = props.points;
    if (w === 0 || pts.length === 0) return null;
    const innerH = h() - padY * 2;
    const innerW = w - padX * 2;
    const x = (i: number) => padX + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
    const y = (v: number) => padY + innerH - (Math.max(0, Math.min(max(), v)) / max()) * innerH;
    const coords = pts.map((p, i) => ({ x: x(i), y: y(p.value), p }));
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${(h() - padY).toFixed(1)} L${coords[0].x.toFixed(1)},${(h() - padY).toFixed(1)} Z`;
    return { coords, line, area, w };
  };

  return (
    <div ref={setRef} class="w-full">
      <Show when={geom()} fallback={<div style={{ height: `${h()}px` }} />}>
        {(g) => (
          <svg width={g().w} height={h()} viewBox={`0 0 ${g().w} ${h()}`} role="img" aria-label="Score over time">
            <defs>
              <linearGradient id="lc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>
            {/* baseline */}
            <line x1={padX} y1={h() - padY} x2={g().w - padX} y2={h() - padY} stroke="var(--line)" stroke-width="1" />
            <path d={g().area} fill="url(#lc-fill)" />
            <path d={g().line} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            <For each={g().coords}>
              {(c) => (
                <circle cx={c.x} cy={c.y} r="3" fill="var(--surface)" stroke="var(--accent)" stroke-width="2">
                  <title>{c.p.label}: {c.p.value.toFixed(1)}{c.p.meta ? ` · ${c.p.meta}` : ""}</title>
                </circle>
              )}
            </For>
          </svg>
        )}
      </Show>
    </div>
  );
}

export interface DonutSegment { value: number; color: string; label: string }

/** Donut with a centered headline. Segments with value 0 are skipped. */
export function Donut(props: { segments: DonutSegment[]; size?: number; centerTop?: JSX.Element; centerSub?: string }) {
  const size = () => props.size ?? 168;
  const stroke = 18;
  const r = () => (size() - stroke) / 2;
  const c = () => 2 * Math.PI * r();
  const total = () => props.segments.reduce((s, x) => s + x.value, 0);

  const arcs = () => {
    const circumference = c();
    const t = total() || 1;
    let offset = 0;
    return props.segments
      .filter((s) => s.value > 0)
      .map((s) => {
        const frac = s.value / t;
        const len = frac * circumference;
        const arc = { ...s, len, gap: circumference - len, offset };
        offset += len;
        return arc;
      });
  };

  return (
    <div class="relative grid place-items-center" style={{ width: `${size()}px`, height: `${size()}px`, margin: "0 auto" }}>
      <svg width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`} style={{ transform: "rotate(-90deg)" }} role="img" aria-label="Outcome mix">
        <circle cx={size() / 2} cy={size() / 2} r={r()} fill="none" stroke="var(--surface-2)" stroke-width={stroke} />
        <For each={arcs()}>
          {(a) => (
            <circle
              cx={size() / 2} cy={size() / 2} r={r()} fill="none"
              stroke={a.color} stroke-width={stroke}
              stroke-dasharray={`${a.len} ${a.gap}`} stroke-dashoffset={-a.offset}
            >
              <title>{a.label}: {a.value}</title>
            </circle>
          )}
        </For>
      </svg>
      <Show when={props.centerTop || props.centerSub}>
        <div class="absolute inset-0 grid place-items-center text-center">
          <div>
            <Show when={props.centerTop}><div class="text-[22px] font-extrabold tracking-tight text-ink leading-none">{props.centerTop}</div></Show>
            <Show when={props.centerSub}><div class="text-[11px] text-muted mt-1">{props.centerSub}</div></Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
