import type { JSX } from "solid-js";

// Minimal inline icon set (no icon dependency). Stroke inherits currentColor.
const paths: Record<string, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  calls: <><path d="M4 5h16M4 12h16M4 19h10" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M4 19a5 5 0 0 1 10 0" /><path d="M16 6a3 3 0 0 1 0 6M15 14a5 5 0 0 1 5 5" /></>,
  trends: <><path d="M4 19V5M4 19h16" /><path d="M7 15l4-5 3 3 5-7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  chevronDown: <><path d="M6 9l6 6 6-6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>,
  arrowLeft: <><path d="M19 12H5M12 19l-7-7 7-7" /></>,
  arrowRight: <><path d="M5 12h14M12 5l7 7-7 7" /></>,
  check: <><path d="M20 6L9 17l-5-5" /></>,
  bolt: <><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></>,
};

export function Icon(props: {
  name: keyof typeof paths | string;
  size?: number;
  class?: string;
  style?: JSX.CSSProperties | string;
}) {
  return (
    <svg
      class={props.class}
      style={props.style}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths[props.name] ?? null}
    </svg>
  );
}
