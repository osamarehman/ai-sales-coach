import { render } from "solid-js/web";
import "./app.css";
import { App } from "./App";
import { initTelemetry } from "./lib/telemetry";

initTelemetry(); // PostHog RUM — no-op unless VITE_POSTHOG_KEY is set
render(() => <App />, document.getElementById("root")!);
