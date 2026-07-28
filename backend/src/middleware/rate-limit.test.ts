import { describe, it, expect } from "bun:test";
import type { Request, Response } from "express";
import { rateLimit } from "./rate-limit";

// Minimal Express req/res doubles: we only exercise ip, setHeader, status().json(), next.
function fakeReq(ip: string): Request {
  return { ip } as Request;
}
function fakeRes() {
  const res: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    status: (c: number) => typeof res;
    json: (b: unknown) => typeof res;
    setHeader: (k: string, v: string) => void;
  } = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
  return res;
}
function run(mw: ReturnType<typeof rateLimit>, ip: string) {
  const res = fakeRes();
  let nexted = false;
  mw(fakeReq(ip), res as unknown as Response, () => {
    nexted = true;
  });
  return { res, nexted };
}

describe("rateLimit", () => {
  it("allows up to max, then 429s with Retry-After", () => {
    let t = 1_000;
    const mw = rateLimit({ windowMs: 60_000, max: 3, now: () => t });

    for (let i = 0; i < 3; i++) {
      const { res, nexted } = run(mw, "1.1.1.1");
      expect(nexted).toBe(true);
      expect(res.statusCode).toBe(200);
    }
    const { res, nexted } = run(mw, "1.1.1.1");
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: "rate limited" });
    expect(res.headers["Retry-After"]).toBeDefined();
    expect(res.headers["RateLimit-Remaining"]).toBe("0");
  });

  it("resets after the window elapses", () => {
    let t = 0;
    const mw = rateLimit({ windowMs: 1_000, max: 1, now: () => t });

    expect(run(mw, "2.2.2.2").nexted).toBe(true); // 1st ok
    expect(run(mw, "2.2.2.2").nexted).toBe(false); // 2nd blocked
    t += 1_001; // window passes
    expect(run(mw, "2.2.2.2").nexted).toBe(true); // fresh window
  });

  it("keys are independent (one IP's flood doesn't block another)", () => {
    let t = 5;
    const mw = rateLimit({ windowMs: 60_000, max: 1, now: () => t });

    expect(run(mw, "3.3.3.3").nexted).toBe(true);
    expect(run(mw, "3.3.3.3").nexted).toBe(false); // 3.3 exhausted
    expect(run(mw, "4.4.4.4").nexted).toBe(true); // 4.4 unaffected
  });
});
