import { describe, it, expect } from "bun:test";
import { signRealtimeToken, verifyRealtimeToken } from "./token";

const SECRET = "test-secret-test-secret-test-secret";

describe("realtime token (verify side)", () => {
  it("round-trips claims", () => {
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET);
    const c = verifyRealtimeToken(t, SECRET);
    expect(c.tid).toBe("T1");
    expect(c.uid).toBe("U1");
  });

  it("rejects a wrong secret", () => {
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET);
    expect(() => verifyRealtimeToken(t, "nope-nope-nope-nope-nope-nope-xx")).toThrow();
  });

  it("rejects an expired token", () => {
    const past = 1_000_000_000_000;
    const t = signRealtimeToken({ tid: "T1", uid: "U1", role: "owner" }, SECRET, 60, past);
    expect(() => verifyRealtimeToken(t, SECRET, past + 61_000)).toThrow();
  });

  it("rejects a malformed token", () => {
    expect(() => verifyRealtimeToken("garbage", SECRET)).toThrow();
  });
});
