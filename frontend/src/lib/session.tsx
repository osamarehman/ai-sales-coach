// Session gate + context. `Protected` wraps every authed route: it loads
// `/api/me`, redirects to /login on 401, and exposes the user + tenant via
// `useSession()` so screens and the AppShell read the real identity.

import { createContext, createResource, createEffect, useContext, Show, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { ApiError, getMe } from "./api";
import { identifyUser } from "./telemetry";
import type { Me } from "./types";

const SessionContext = createContext<() => Me>();

export function useSession(): Me {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <Protected>");
  return ctx();
}

/** True for owner/admin — the roles allowed to see org-wide views. */
export const isManager = (me: Me) => me.user.role === "owner" || me.user.role === "admin";

function Splash(props: { children: JSX.Element }) {
  return (
    <div class="min-h-screen grid place-items-center bg-bg text-muted text-sm">
      {props.children}
    </div>
  );
}

export function Protected(props: { children?: JSX.Element }) {
  const nav = useNavigate();
  const [me] = createResource<Me>(async () => {
    try {
      return await getMe();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        nav("/login", { replace: true });
      }
      throw err;
    }
  });

  // Identify the signed-in user to PostHog so client-side errors carry the same user/tenant the
  // server-side capture tags. Fires once me() resolves; inert when telemetry is off.
  createEffect(() => {
    const m = me();
    if (m) identifyUser(m.user, m.tenant.id);
  });

  return (
    <Show
      when={me()}
      fallback={
        <Show
          when={me.error && !(me.error instanceof ApiError && me.error.status === 401)}
          fallback={<Splash>Loading your workspace…</Splash>}
        >
          <Splash>
            <div class="text-center">
              <p class="text-ink font-semibold">Couldn't reach the server.</p>
              <p class="mt-1">Check your connection and refresh.</p>
            </div>
          </Splash>
        </Show>
      }
    >
      {(data) => (
        <SessionContext.Provider value={data}>{props.children}</SessionContext.Provider>
      )}
    </Show>
  );
}
