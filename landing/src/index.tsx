import { render } from "solid-js/web";
import "./app.css";
import { Landing } from "./Landing";
import { initTelemetry } from "./telemetry";

initTelemetry(); // PostHog RUM — no-op unless VITE_POSTHOG_KEY is set
const root = document.getElementById("root");
if (root) render(() => <Landing />, root);
