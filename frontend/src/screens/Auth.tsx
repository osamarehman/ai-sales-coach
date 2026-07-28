import { createSignal, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { Icon } from "../components/icons";
import { ApiError, signIn, signUp } from "../lib/api";

function BrandMark() {
  return (
    <div class="flex items-center gap-2.5 justify-center mb-6">
      <span class="w-7 h-7 rounded-[8px] grid place-items-center text-white"
        style={{ background: "linear-gradient(150deg, var(--accent), var(--accent-strong))" }}>
        <Icon name="bolt" size={15} />
      </span>
      <b class="text-base tracking-tight">Sales Coach</b>
    </div>
  );
}

export function Auth(props: { mode?: "signup" | "login" }) {
  const isSignup = () => props.mode !== "login";
  const nav = useNavigate();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setError("");
    setBusy(true);
    try {
      if (isSignup()) {
        await signUp({ name: name().trim(), email: email().trim(), password: password() });
        nav("/onboarding", { replace: true });
      } else {
        await signIn({ email: email().trim(), password: password() });
        nav("/", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || (isSignup() ? "Couldn't create your workspace." : "Invalid email or password."));
      } else {
        setError("Couldn't reach the server. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="min-h-screen grid place-items-center p-6"
      style={{ background: "radial-gradient(120% 120% at 50% -10%, var(--accent-tint) 0, var(--bg) 46%)" }}>
      <div class="w-[380px] max-w-full">
        <BrandMark />
        <form class="card p-[22px]" onSubmit={submit}>
          <h1 class="text-[19px] font-bold text-center text-ink">{isSignup() ? "Create your workspace" : "Welcome back"}</h1>
          <p class="text-muted text-center text-[13px] mt-1.5 mb-5">
            {isSignup() ? "Grade every sales call against the H.E.A.R.T. rubric." : "Log in to your Sales Coach workspace."}
          </p>

          <div class="space-y-3.5">
            <Show when={isSignup()}>
              <div>
                <div class="field-label mb-1.5">Your name</div>
                <input class="input" placeholder="Jordan Lee" autocomplete="name"
                  value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
              </div>
            </Show>
            <div>
              <div class="field-label mb-1.5">Work email</div>
              <input class="input" type="email" placeholder="you@company.com" autocomplete="email"
                value={email()} onInput={(e) => setEmail(e.currentTarget.value)} required />
            </div>
            <div>
              <div class="field-label mb-1.5">Password</div>
              <input class="input" type="password" placeholder={isSignup() ? "8+ characters" : "Your password"}
                autocomplete={isSignup() ? "new-password" : "current-password"}
                value={password()} onInput={(e) => setPassword(e.currentTarget.value)} required minLength={8} />
              <Show when={isSignup()}>
                <p class="text-xs text-muted mt-1.5">Signing up creates your organization — you'll be the owner.</p>
              </Show>
            </div>
          </div>

          <Show when={error()}>
            <p class="text-[12.5px] mt-3.5 px-3 py-2 rounded-[8px]"
              style={{ background: "var(--neg-tint)", color: "var(--neg-ink)" }}>{error()}</p>
          </Show>

          <button type="submit" disabled={busy()}
            class="btn btn-primary w-full justify-center !h-10 mt-4 mb-3.5">
            {busy() ? "Please wait…" : isSignup() ? "Create workspace" : "Log in"}
          </button>
          <p class="text-muted text-center text-[13px]">
            {isSignup() ? <>Already have an account? <A href="/login" class="text-ink font-semibold">Log in</A></>
                        : <>New here? <A href="/signup" class="text-ink font-semibold">Create a workspace</A></>}
          </p>
        </form>
      </div>
    </div>
  );
}
