/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";
import { initTelemetry } from "./telemetry";

initTelemetry(); // PostHog RUM — no-op unless VITE_POSTHOG_KEY is set
render(() => <App />, document.getElementById("root")!);
