import { Router, Route } from "@solidjs/router";
import { Protected } from "./lib/session";
import { Dashboard } from "./screens/Dashboard";
import { CallsList } from "./screens/CallsList";
import { Scorecard } from "./screens/Scorecard";
import { Trends } from "./screens/Trends";
import { Team } from "./screens/Team";
import { Settings } from "./screens/Settings";
import { Auth } from "./screens/Auth";
import { Onboarding } from "./screens/Onboarding";

export function App() {
  return (
    <Router>
      {/* Public */}
      <Route path="/signup" component={() => <Auth mode="signup" />} />
      <Route path="/login" component={() => <Auth mode="login" />} />

      {/* Authed — Protected loads /api/me, guards, and provides session context */}
      <Route path="/" component={Protected}>
        <Route path="/" component={Dashboard} />
        <Route path="/calls" component={CallsList} />
        <Route path="/calls/:id" component={Scorecard} />
        <Route path="/trends" component={Trends} />
        <Route path="/team" component={Team} />
        <Route path="/settings/*" component={Settings} />
        <Route path="/onboarding" component={Onboarding} />
      </Route>
    </Router>
  );
}
