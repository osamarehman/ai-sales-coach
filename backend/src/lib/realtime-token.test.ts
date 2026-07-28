import { describe, it, expect } from "bun:test";
import { signRealtimeToken, verifyRealtimeToken } from "./realtime-token";

const SECRET = "test-secret-test-secret-test-secret";

describe("realtime token", () => {
  it("round-trips claims", () => {
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET);
    const c = verifyRealtimeToken(t, SECRET);
    expect(c.tid).toBe("T1");
    expect(c.uid).toBe("U1");
    expect(c.role).toBe("owner");
    expect(c.exp).toBeGreaterThan(c.iat);
  });

  it("rejects a tampered payload", () => {
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET);
    const [v, p, s] = t.split(".");
    const badP = p.slice(0, -1) + (p.slice(-1) === "A" ? "B" : "A");
    expect(() => verifyRealtimeToken(`${v}.${badP}.${s}`, SECRET)).toThrow();
  });

  it("rejects a wrong secret", () => {
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET);
    expect(() => verifyRealtimeToken(t, "another-secret-another-secret-xx")).toThrow();
  });

  it("rejects an expired token", () => {
    const past = 1_000_000_000_000; // fixed clock
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET, 60, past);
    expect(() => verifyRealtimeToken(t, SECRET, past + 61_000)).toThrow();
  });

  it("accepts within ttl", () => {
    const base = 1_000_000_000_000;
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET, 300, base);
    expect(verifyRealtimeToken(t, SECRET, base + 100_000).uid).toBe("U1");
  });

  it("rejects a malformed token", () => {
    expect(() => verifyRealtimeToken("not-a-token", SECRET)).toThrow();
  });
});
