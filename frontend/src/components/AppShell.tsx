import { createSignal, For, Show, type JSX } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { Icon } from "./icons";
import { Avatar } from "./ui";
import { signOut } from "../lib/api";
import { isManager, useSession } from "../lib/session";

const NAV = [
  { href: "/", label: "Dashboard", icon: "dashboard", end: true, manager: false },
  { href: "/calls", label: "Calls", icon: "calls", end: false, manager: false },
  { href: "/team", label: "Team", icon: "team", end: false, manager: true },
  { href: "/trends", label: "Trends", icon: "trends", end: false, manager: true },
];

function currentTheme(): "dark" | "light" {
  const el = document.documentElement;
  if (el.classList.contains("dark")) return "dark";
  if (el.classList.contains("light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggle() {
  const [theme, setTheme] = createSignal<"dark" | "light">(currentTheme());
  const toggle = () => {
    const next = theme() === "dark" ? "light" : "dark";
    const el = document.documentElement;
    el.classList.remove("dark", "light");
    el.classList.add(next);
    try { localStorage.setItem("theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  return (
    <button class="btn btn-sm btn-ghost" onClick={toggle} aria-label="Toggle theme">
      <Icon name={theme() === "dark" ? "sun" : "moon"} size={15} />
    </button>
  );
}

function NavList(props: { onNavigate?: () => void }) {
  const loc = useLocation();
  const session = useSession();
  const items = () => NAV.filter((item) => !item.manager || isManager(session));
  const isActive = (href: string, end: boolean) =>
    end ? loc.pathname === "/" : loc.pathname === href || loc.pathname.startsWith(href + "/");
  return (
    <nav class="flex flex-col gap-0.5">
      <For each={items()}>
        {(item) => (
          <A
            href={item.href}
            onClick={() => props.onNavigate?.()}
            class="flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
            classList={{ "!bg-brand-tint !text-brand-ink font-semibold": isActive(item.href, item.end) }}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </A>
        )}
      </For>
      <div class="text-[11px] uppercase tracking-[.07em] text-faint px-2 pt-3.5 pb-1.5">Workspace</div>
      <A
        href="/settings"
        onClick={() => props.onNavigate?.()}
        class="flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
        classList={{ "!bg-brand-tint !text-brand-ink font-semibold": loc.pathname.startsWith("/settings") }}
      >
        <Icon name="settings" size={16} />
        Settings
      </A>
    </nav>
  );
}

function Brand() {
  return (
    <div class="flex items-center gap-2.5 px-2 pt-1.5 pb-4">
      <span class="w-7 h-7 rounded-[8px] grid place-items-center text-white"
        style={{ background: "linear-gradient(150deg, var(--accent), var(--accent-strong))" }}>
        <Icon name="bolt" size={15} />
      </span>
      <b class="text-[14.5px] tracking-tight">Sales Coach</b>
    </div>
  );
}

function UserChip() {
  const session = useSession();
  const nav = useNavigate();
  const name = () => session.user.name || session.user.email.split("@")[0];
  const roleLabel = () => (isManager(session) ? "Manager" : "Rep");
  const [busy, setBusy] = createSignal(false);
  const doSignOut = async () => {
    if (busy()) return;
    setBusy(true);
    try { await signOut(); } catch { /* fall through to redirect */ }
    nav("/login", { replace: true });
  };
  return (
    <div class="flex items-center gap-2.5 px-2 pt-2.5 mt-2 border-t" style={{ "border-color": "var(--line)" }}>
      <Avatar name={name()} size={28} />
      <div class="text-[12.5px] leading-tight min-w-0 flex-1">
        <span class="truncate block text-ink">{name()}</span>
        <small class="text-muted truncate block">{session.tenant.name} · {roleLabel()}</small>
      </div>
      <button class="btn btn-sm btn-ghost shrink-0" onClick={doSignOut} disabled={busy()} aria-label="Sign out" title="Sign out">
        <Icon name="external" size={15} />
      </button>
    </div>
  );
}

export function AppShell(props: { crumbs: JSX.Element; actions?: JSX.Element; children: JSX.Element }) {
  const [drawer, setDrawer] = createSignal(false);
  return (
    <div class="min-h-screen lg:grid" style={{ "grid-template-columns": "236px 1fr" }}>
      {/* Desktop sidebar */}
      <aside class="hidden lg:flex flex-col gap-0.5 bg-surface border-r p-[14px] pt-[18px]" style={{ "border-color": "var(--line)" }}>
        <Brand />
        <NavList />
        <div class="flex-1" />
        <UserChip />
      </aside>

      {/* Mobile drawer */}
      <Show when={drawer()}>
        <div class="fixed inset-0 z-40 lg:hidden">
          <div class="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside class="absolute left-0 top-0 h-full w-[264px] bg-surface border-r p-[14px] pt-[18px] flex flex-col gap-0.5 shadow-xl" style={{ "border-color": "var(--line)" }}>
            <div class="flex items-center">
              <Brand />
              <div class="flex-1" />
              <button class="btn btn-sm btn-ghost" onClick={() => setDrawer(false)} aria-label="Close menu"><Icon name="close" size={16} /></button>
            </div>
            <NavList onNavigate={() => setDrawer(false)} />
            <div class="flex-1" />
            <UserChip />
          </aside>
        </div>
      </Show>

      {/* Main column */}
      <div class="min-w-0 flex flex-col">
        <div class="sticky top-0 z-30 flex items-center gap-3.5 px-4 lg:px-7 py-3 border-b backdrop-blur"
          style={{ "border-color": "var(--line)", background: "color-mix(in srgb, var(--surface) 72%, transparent)" }}>
          <button class="btn btn-sm btn-ghost lg:hidden -ml-1.5" onClick={() => setDrawer(true)} aria-label="Open menu"><Icon name="menu" size={18} /></button>
          <div class="text-[13px] text-muted min-w-0 truncate">{props.crumbs}</div>
          <div class="flex-1" />
          {props.actions}
          <ThemeToggle />
        </div>
        <main class="px-4 lg:px-7 pt-6 pb-12">{props.children}</main>
      </div>
    </div>
  );
}
