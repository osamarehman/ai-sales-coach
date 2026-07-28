import { test, expect } from "bun:test";
import { WaitlistSignup } from "./waitlist";

test("normalizes email (trim + lowercase)", () => {
  const r = WaitlistSignup.parse({ email: "  Rep@Example.COM " });
  expect(r.email).toBe("rep@example.com");
});

test("rejects an invalid email", () => {
  expect(() => WaitlistSignup.parse({ email: "not-an-email" })).toThrow();
});

test("honeypot: rejects when the hidden company field is filled", () => {
  expect(() => WaitlistSignup.parse({ email: "a@b.com", company: "Acme Corp" })).toThrow();
});

test("accepts an empty honeypot and keeps an optional source tag", () => {
  const r = WaitlistSignup.parse({ email: "a@b.com", company: "", source: "landing-hero" });
  expect(r.source).toBe("landing-hero");
});
