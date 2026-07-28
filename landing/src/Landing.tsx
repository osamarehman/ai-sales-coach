import { createSignal, Show, For } from "solid-js";

/* ============================================================
   Waitlist capture — reused in the hero and the final CTA.
   Posts first-party to /api/waitlist (backend routes/waitlist.ts).
   ============================================================ */
function WaitlistForm(props: { source: string; cta: string }) {
  const [email, setEmail] = createSignal("");
  const [company, setCompany] = createSignal(""); // honeypot — humans never fill this
  const [state, setState] = createSignal<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = createSignal("");

  const submit = async (e: Event) => {
    e.preventDefault();
    if (state() === "submitting" || state() === "done") return;
    setState("submitting");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email(), company: company(), source: props.source }),
      });
      if (!res.ok)
        throw new Error(
          res.status === 429
            ? "That's a lot of tries — give it a minute, then retry."
            : "Please enter a valid email address.",
        );
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    }
  };

  return (
    <Show
      when={state() !== "done"}
      fallback={
        <div class="chip-yes flex items-center gap-2.5 rounded-[10px] px-4 py-3.5 text-[15px] font-semibold">
          <span aria-hidden="true">✓</span>
          You're on the list — we'll email you the moment your seat opens.
        </div>
      }
    >
      <form onSubmit={submit} class="w-full">
        <div class="flex flex-col sm:flex-row gap-2.5">
          <input
            type="email"
            required
            autocomplete="email"
            placeholder="you@work.com"
            class="input flex-1 !h-[44px]"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            disabled={state() === "submitting"}
            aria-label="Work email"
          />
          {/* honeypot: off-screen, hidden from humans; bots that fill it are rejected server-side */}
          <input
            type="text"
            name="company"
            tabindex="-1"
            autocomplete="off"
            aria-hidden="true"
            class="absolute -left-[9999px] h-0 w-0 opacity-0"
            value={company()}
            onInput={(e) => setCompany(e.currentTarget.value)}
          />
          <button
            type="submit"
            class="btn btn-primary !h-[44px] justify-center px-6 text-[14px]"
            disabled={state() === "submitting"}
          >
            {state() === "submitting" ? "Joining…" : props.cta}
          </button>
        </div>
        <Show
          when={state() === "error"}
          fallback={<p class="mt-2 text-[12.5px] text-muted">No spam. One email, when your seat opens.</p>}
        >
          <p class="mt-2 text-[13px]" style={{ color: "var(--neg-ink)" }}>{error()}</p>
        </Show>
      </form>
    </Show>
  );
}

/* ---------- Section content (data-driven so the JSX stays flat) ---------- */
const STEPS = [
  {
    n: "1",
    title: "Capture",
    body: "Runs quietly on your side of any call — Zoom, Meet, Teams, or your dialer. No bot joins the meeting.",
  },
  {
    n: "2",
    title: "Live cues",
    body: "The instant the conversation needs it, a short prompt appears: the question to ask, the objection to defuse, the moment to slow down.",
  },
  {
    n: "3",
    title: "Report",
    body: "After you hang up, see exactly where the call turned — and the one thing to do differently on the next one.",
  },
  {
    n: "4",
    title: "Practice",
    body: "It builds an AI version of your prospect from the real call, so you can run the pitch again until it's automatic.",
  },
] as const;

const SIGNALS = [
  { k: "Talk-ratio", v: "Nudges you to talk less and let the prospect open up." },
  { k: "Tone", v: "Reads the emotional temperature so you match it, not miss it." },
  { k: "Pace", v: "Flags when you're rushing the moment that closes the deal." },
] as const;

export function Landing() {
  return (
    <div class="min-h-screen">
      {/* ---- Top bar ---- */}
      <header class="mx-auto flex max-w-[1080px] items-center gap-3 px-5 py-5">
        <div class="grid h-8 w-8 place-items-center rounded-[9px] text-[15px] font-black text-white"
          style={{ background: "linear-gradient(150deg, var(--accent), var(--accent-strong))" }}>
          ◈
        </div>
        <span class="text-[15px] font-bold tracking-tight">AI Sales Coach</span>
        <span class="chip ml-1"><span class="dot" />Early access</span>
      </header>

      {/* ---- Hero ---- */}
      <section class="mx-auto grid max-w-[1080px] items-center gap-12 px-5 pt-10 pb-16 lg:grid-cols-[1.05fr_.95fr] lg:pt-16">
        <div>
          <p class="text-[13px] font-bold uppercase tracking-[.08em] text-brand-ink">
            For the individual closer — not the manager
          </p>
          <h1 class="mt-3 text-[38px] font-extrabold leading-[1.05] tracking-[-0.02em] sm:text-[52px]">
            An AI sales coach in your ear — <span class="text-brand">live, on every call.</span>
          </h1>
          <p class="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink-2">
            Real-time cues while you talk. A coaching report after. And a practice partner built from
            your real prospect. Your unfair advantage on the next call you take.
          </p>
          <div class="mt-7 max-w-[440px]">
            <WaitlistForm source="landing-hero" cta="Join the waitlist" />
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
            <span class="inline-flex items-center gap-1.5"><b class="text-pos">✓</b> Works on any call</span>
            <span class="inline-flex items-center gap-1.5"><b class="text-pos">✓</b> Only you see it</span>
            <span class="inline-flex items-center gap-1.5"><b class="text-pos">✓</b> Pay as you go</span>
          </div>
        </div>

        {/* Product glimpse: a faux live-cue card */}
        <div class="relative">
          <div class="card p-5" style={{ "box-shadow": "var(--shadow-lg)" }}>
            <div class="flex items-center justify-between">
              <span class="chip chip-live"><span class="dot" />LIVE</span>
              <span class="text-[12.5px] font-semibold text-muted" style={{ "font-variant-numeric": "tabular-nums" }}>
                14:22
              </span>
            </div>
            <div class="mt-4 rounded-[10px] border p-4" style={{ background: "var(--brand-tint)", "border-color": "transparent" }}>
              <p class="text-[11px] font-bold uppercase tracking-[.07em] text-brand-ink">Cue · ask now</p>
              <p class="mt-1.5 text-[15px] font-semibold leading-snug text-ink">
                They just raised budget. Ask what it costs them to leave this unsolved for another quarter.
              </p>
            </div>
            <div class="mt-4 flex items-center gap-2">
              <span class="chip">Consequence question</span>
              <span class="chip chip-yes"><span class="dot" />Momentum</span>
            </div>
            <div class="mt-4 border-t pt-3.5">
              <div class="flex items-center justify-between text-[12px] text-muted">
                <span>You're talking 61%</span><span>Aim for ~43%</span>
              </div>
              <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                <div class="h-full rounded-full" style={{ width: "61%", background: "var(--accent)" }} />
              </div>
            </div>
          </div>
          <p class="mt-3 text-center text-[12px] text-muted">A cue lands the moment it matters — then gets out of your way.</p>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section class="border-t" style={{ "border-color": "var(--line)", background: "var(--surface-2)" }}>
        <div class="mx-auto max-w-[1080px] px-5 py-16">
          <h2 class="text-[26px] font-bold tracking-tight">How it works</h2>
          <p class="mt-2 text-[15px] text-muted">Capture → Live cues → Report → Practice.</p>
          <div class="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <For each={STEPS}>
              {(s) => (
                <div class="card p-5">
                  <div class="grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold text-white"
                    style={{ background: "var(--accent)" }}>
                    {s.n}
                  </div>
                  <h3 class="mt-3.5 text-[16px] font-bold">{s.title}</h3>
                  <p class="mt-1.5 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
                </div>
              )}
            </For>
          </div>
        </div>
      </section>

      {/* ---- Private-coach angle ---- */}
      <section class="mx-auto max-w-[1080px] px-5 py-16">
        <div class="card overflow-hidden p-8 sm:p-10" style={{ "box-shadow": "var(--shadow)" }}>
          <div class="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <h2 class="text-[26px] font-bold leading-tight tracking-tight">
                Your own coach — not your manager's dashboard.
              </h2>
              <p class="mt-4 text-[16px] leading-relaxed text-ink-2">
                This is a personal tool you run for yourself. It lives on your side of the call and only
                you see it. Nothing is pushed to a team feed, a leaderboard, or your boss — just quiet,
                in-the-moment help that makes you sharper on the calls that pay you.
              </p>
            </div>
            <div class="grid gap-3">
              <div class="rounded-[10px] border p-4" style={{ background: "var(--surface-2)" }}>
                <p class="text-[14px] font-semibold text-ink">Built on proven questioning &amp; discovery techniques</p>
                <p class="mt-1 text-[13.5px] text-muted">
                  The kind top closers use to let the prospect talk themselves into the sale — turned into
                  live prompts you can act on mid-sentence.
                </p>
              </div>
              <div class="rounded-[10px] border p-4" style={{ background: "var(--surface-2)" }}>
                <p class="text-[14px] font-semibold text-ink">Reads the call as it happens</p>
                <p class="mt-1 text-[13.5px] text-muted">
                  Talk-ratio, tone, and pace in real time — so a cue arrives when it counts, not after
                  you've already hung up.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Why it works (signals) ---- */}
      <section class="border-t" style={{ "border-color": "var(--line)", background: "var(--surface-2)" }}>
        <div class="mx-auto max-w-[1080px] px-5 py-16">
          <h2 class="text-[26px] font-bold tracking-tight">It listens to how the call is really going</h2>
          <p class="mt-2 max-w-[60ch] text-[15px] text-muted">
            Not just the words. The signals that separate a call that closes from one that stalls.
          </p>
          <div class="mt-9 grid gap-4 sm:grid-cols-3">
            <For each={SIGNALS}>
              {(s) => (
                <div class="card p-5">
                  <p class="text-[15px] font-bold text-brand-ink">{s.k}</p>
                  <p class="mt-1.5 text-[14px] leading-relaxed text-ink-2">{s.v}</p>
                </div>
              )}
            </For>
          </div>
        </div>
      </section>

      {/* ---- Pricing teaser ---- */}
      <section class="mx-auto max-w-[1080px] px-5 py-16">
        <div class="mx-auto max-w-[640px] text-center">
          <span class="chip mx-auto"><span class="dot" />Pricing</span>
          <h2 class="mt-4 text-[28px] font-bold tracking-tight">Pay only for the calls you run.</h2>
          <p class="mt-3 text-[16px] leading-relaxed text-ink-2">
            Simple pay-as-you-go credits — no seat you forget to cancel, no annual contract. Pour more in
            when a call is converting; spend nothing on the days you don't sell.
            <span class="font-semibold text-ink"> One closed deal pays for months.</span>
          </p>
        </div>
      </section>

      {/* ---- Final CTA ---- */}
      <section class="px-5 pb-20">
        <div class="mx-auto max-w-[760px] rounded-[16px] px-6 py-12 text-center sm:px-12"
          style={{ background: "linear-gradient(150deg, var(--accent), var(--accent-strong))", "box-shadow": "var(--shadow-lg)" }}>
          <h2 class="text-[28px] font-extrabold tracking-tight text-white sm:text-[34px]">
            Get early access — limited seats.
          </h2>
          <p class="mx-auto mt-3 max-w-[46ch] text-[16px] leading-relaxed" style={{ color: "rgba(255,255,255,.86)" }}>
            We're onboarding individual reps in small batches. Add your email and we'll open your seat next.
          </p>
          <div class="mx-auto mt-7 max-w-[440px] text-left">
            <div class="rounded-[12px] bg-surface p-4" style={{ "box-shadow": "var(--shadow-sm)" }}>
              <WaitlistForm source="landing-final" cta="Claim my seat" />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer class="border-t" style={{ "border-color": "var(--line)" }}>
        <div class="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-2 px-5 py-8 text-[13px] text-muted sm:flex-row">
          <span>© 2026 AI Sales Coach</span>
          <span>Made for the rep, not the manager.</span>
        </div>
      </footer>
    </div>
  );
}
