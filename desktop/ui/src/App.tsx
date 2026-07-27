import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Cue = { id: string; tier: string; text: string; category: string; ttl_ms: number };
type Phase = "idle" | "connecting" | "ready" | "capturing" | "ended";

export default function App() {
  const [url, setUrl] = createSignal("ws://localhost:8787");
  const [token, setToken] = createSignal("dev");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [status, setStatus] = createSignal("");
  const [error, setError] = createSignal("");
  const [consented, setConsented] = createSignal(false);
  const [cue, setCue] = createSignal<Cue | null>(null);

  let cueTimer: ReturnType<typeof setTimeout> | undefined;
  const unlisteners: UnlistenFn[] = [];

  onMount(async () => {
    unlisteners.push(
      await listen<string>("status", (e) => {
        setStatus(e.payload);
        if (e.payload.startsWith("ready")) setPhase("ready");
        else if (e.payload === "capturing") setPhase("capturing");
      }),
      await listen<Cue>("cue", (e) => {
        setCue(e.payload);
        if (cueTimer) clearTimeout(cueTimer);
        cueTimer = setTimeout(() => setCue(null), e.payload.ttl_ms || 7000);
      }),
      await listen<string>("session-error", (e) => setError(e.payload)),
      await listen("ended", () => setPhase("ended")),
    );
  });

  onCleanup(() => {
    unlisteners.forEach((u) => u());
    if (cueTimer) clearTimeout(cueTimer);
  });

  async function start() {
    setError("");
    setPhase("connecting");
    try {
      await invoke("start_session", { url: url(), token: token() });
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  async function giveConsent() {
    try {
      await invoke("set_consent", { method: "checkbox" });
      setConsented(true);
    } catch (e) {
      setError(String(e));
    }
  }

  async function stop() {
    try {
      await invoke("stop_session");
    } catch (e) {
      setError(String(e));
    }
    setPhase("idle");
    setConsented(false);
    setCue(null);
  }

  const running = () => phase() !== "idle" && phase() !== "ended";

  return (
    <div class="app">
      <header class="titlebar" data-tauri-drag-region>
        <span class="dot" classList={{ live: phase() === "capturing" }} />
        <span class="title" data-tauri-drag-region>AI Sales Coach</span>
        <button class="x" title="Close" onClick={() => getCurrentWindow().close()}>
          ×
        </button>
      </header>

      <Show when={running()} fallback={
        <section class="setup">
          <label>Backend</label>
          <input value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="ws://localhost:8787" />
          <input value={token()} onInput={(e) => setToken(e.currentTarget.value)} placeholder="session token" />
          <button class="primary" onClick={start}>Start session</button>
          <Show when={error()}>
            <p class="err">{error()}</p>
          </Show>
        </section>
      }>
        <section class="live">
          <Show when={!consented()} fallback={
            <div class="cue-area">
              <Show when={cue()} fallback={<p class="muted">Listening… coaching cues will appear here.</p>}>
                {(c) => (
                  <div class="cue" classList={{ crit: c().tier === "crit", help: c().tier === "help", fyi: c().tier === "fyi" }}>
                    <span class="cat">{c().category}</span>
                    <p>{c().text}</p>
                  </div>
                )}
              </Show>
            </div>
          }>
            <div class="consent">
              <p>Confirm all parties on this call have consented to recording.</p>
              <button class="primary" onClick={giveConsent}>I confirm — start coaching</button>
            </div>
          </Show>

          <footer class="statusbar">
            <span class="muted">{status() || phase()}</span>
            <button class="ghost" onClick={stop}>Stop</button>
          </footer>
          <Show when={error()}>
            <p class="err">{error()}</p>
          </Show>
        </section>
      </Show>
    </div>
  );
}
