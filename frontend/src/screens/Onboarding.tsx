import { createResource, createSignal, For, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Icon } from "../components/icons";
import { connectFathom, getSettings } from "../lib/api";

const steps = ["Connect Fathom", "Call filter", "Done"];

export function Onboarding() {
  const nav = useNavigate();
  const [settings] = createResource(getSettings);
  const webhook = () => settings()?.webhook_url ?? "";

  const [apiKey, setApiKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    if (!webhook()) return;
    try { await navigator.clipboard.writeText(webhook()); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const cont = async () => {
    if (busy()) return;
    setError("");
    if (!apiKey().trim()) { nav("/", { replace: true }); return; }
    setBusy(true);
    try {
      await connectFathom(apiKey().trim());
      nav("/", { replace: true });
    } catch {
      setError("Couldn't save that key. Double-check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="min-h-screen grid place-items-center p-6"
      style={{ background: "radial-gradient(120% 120% at 50% -10%, var(--accent-tint) 0, var(--bg) 46%)" }}>
      <div class="w-[560px] max-w-full">
        <div class="flex items-center gap-2.5 justify-center mb-6">
          <span class="w-7 h-7 rounded-[8px] grid place-items-center text-white"
            style={{ background: "linear-gradient(150deg, var(--accent), var(--accent-strong))" }}>
            <Icon name="bolt" size={15} />
          </span>
          <b class="text-[15px] tracking-tight">Sales Coach</b>
        </div>

        {/* steps */}
        <div class="flex items-center justify-center gap-2 mb-6 flex-wrap">
          <For each={steps}>
            {(s, i) => (
              <>
                <span class="chip" classList={{ "chip-yes": i() === 0 }}><span class="dot" />{i() + 1} · {s}</span>
                {i() < steps.length - 1 && <span class="text-faint">──</span>}
              </>
            )}
          </For>
        </div>

        <div class="card p-[22px]">
          <h1 class="text-[19px] font-bold text-ink">Connect your Fathom account</h1>
          <p class="text-muted mt-1.5 mb-5">We read call transcripts to grade them. Your key is encrypted at rest and never shown again.</p>

          <div class="space-y-4">
            <div>
              <div class="field-label mb-1.5">Fathom API key</div>
              <input class="input" type="password" placeholder="Paste your key (Settings → API & Integrations)"
                value={apiKey()} onInput={(e) => setApiKey(e.currentTarget.value)} />
              <p class="text-xs text-muted mt-1.5">Find it in Fathom under Settings → API & Integrations → Generate API Key.</p>
            </div>
            <div>
              <div class="field-label mb-1.5">Your webhook URL</div>
              <div class="input flex items-center justify-between gap-2">
                <span class="mono text-muted text-[12.5px] truncate">{webhook() || "Loading…"}</span>
                <button class="btn btn-sm shrink-0" onClick={copy} disabled={!webhook()}>
                  <Icon name={copied() ? "check" : "copy"} size={13} />{copied() ? "Copied" : "Copy"}
                </button>
              </div>
              <p class="text-xs text-muted mt-1.5">In Fathom → Settings → Webhooks, add this URL and enable <b class="text-ink-2">Recording completed</b> + <b class="text-ink-2">Transcript available</b>.</p>
            </div>
          </div>

          <Show when={error()}>
            <p class="text-[12.5px] mt-4 px-3 py-2 rounded-[8px]" style={{ background: "var(--neg-tint)", color: "var(--neg-ink)" }}>{error()}</p>
          </Show>

          <div class="flex gap-3 p-4 rounded-[12px] my-5" style={{ border: "1px solid var(--line-strong)", background: "var(--surface-2)" }}>
            <span class="w-5 h-5 rounded-full shrink-0 mt-0.5" style={{ border: "2px solid var(--muted)" }} />
            <div class="text-[13px]">
              <b class="text-ink block">Nothing to grade yet</b>
              <span class="text-muted">We'll analyze calls automatically as Fathom sends them in.</span>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <A href="/" class="btn btn-ghost">Skip for now</A>
            <button class="btn btn-primary" onClick={cont} disabled={busy()}>{busy() ? "Saving…" : "Continue →"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
