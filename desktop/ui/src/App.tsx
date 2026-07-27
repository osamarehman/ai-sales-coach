import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Cue = { id: string; tier: string; text: string; category: string; ttl_ms: number };
type Phase = "idle" | "connecting" | "ready" | "capturing" | "ended";

// Can this webview speak? WKWebView (iOS/macOS) and WebView2 (Windows) always can; most WebKitGTK
// builds do too, but some Linux ones ship without it — so feature-detect and hide the control if not.
const hasTTS = typeof window !== "undefined" && "speechSynthesis" in window;

// The earbud path: on a call the rep is looking away, so cues are spoken into whatever output device
// the OS is using (earbuds when connected — the OS handles routing; we just synthesize). Critical
// cues get a short spoken lead so they're audibly distinct from routine ones. Pure + tiny by design.
function speechTextFor(cue: Cue): string {
  const lead = cue.tier === "crit" ? "Heads up. " : "";
  return `${lead}${cue.text}`.trim();
}

// Persist the rep's on/off choice across sessions. "0" = explicitly muted; anything else = speak.
const SPEAK_PREF_KEY = "aisc.speakCues";

export default function App() {
  const [url, setUrl] = createSignal("ws://localhost:8787");
  const [token, setToken] = createSignal("dev");
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [status, setStatus] = createSignal("");
  const [error, setError] = createSignal("");
  const [consented, setConsented] = createSignal(false);
  const [cue, setCue] = createSignal<Cue | null>(null);
  // Spoken cues on by default wherever TTS exists (this is the whole point on mobile); the rep can mute.
  const [speakCues, setSpeakCues] = createSignal(hasTTS && localStorage.getItem(SPEAK_PREF_KEY) !== "0");

  let cueTimer: ReturnType<typeof setTimeout> | undefined;
  const unlisteners: UnlistenFn[] = [];

  // Speak `text` into the active output device. Freshness wins: cancel any in-flight utterance so the
  // rep always hears the newest cue rather than a backlog (a stale coaching cue is worse than none).
  function speak(text: string) {
    if (!hasTTS || !speakCues() || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; // a touch quick so the cue lands while the moment is still live
    u.volume = 1;
    window.speechSynthesis.speak(u);
  }

  function toggleSpeak() {
    const next = !speakCues();
    setSpeakCues(next);
    localStorage.setItem(SPEAK_PREF_KEY, next ? "1" : "0");
    if (!next && hasTTS) window.speechSynthesis.cancel(); // silence immediately on mute
  }

  onMount(async () => {
    unlisteners.push(
      await listen<string>("status", (e) => {
        setStatus(e.payload);
        if (e.payload.startsWith("ready")) setPhase("ready");
        else if (e.payload === "capturing") setPhase("capturing");
      }),
      await listen<Cue>("cue", (e) => {
        setCue(e.payload);
        speak(speechTextFor(e.payload));
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
    if (hasTTS) window.speechSynthesis.cancel();
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
      // This click is a user gesture: use it both to unlock speech (mobile WebViews gate the first
      // speak() behind a gesture) and to confirm out loud that cue audio is reaching the earbuds.
      speak("Coaching on.");
    } catch (e) {
      setError(String(e));
    }
  }

  async function stop() {
    if (hasTTS) window.speechSynthesis.cancel();
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
              <Show when={cue()} fallback={<p class="muted">Listening… coaching cues will appear here{hasTTS && speakCues() ? " and play to your earbuds" : ""}.</p>}>
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
            <Show when={hasTTS}>
              <button
                class="ghost"
                title={speakCues() ? "Mute spoken cues" : "Speak cues to your earbuds"}
                onClick={toggleSpeak}
              >
                {speakCues() ? "🔊 Cues" : "🔇 Cues"}
              </button>
            </Show>
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
