import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// Short-lived, signed token the desktop/phone client redeems to open the realtime
// WebSocket. The backend SIGNS it (POST /api/realtime/token, behind requireAuth); the
// isolated `realtime` service VERIFIES it with the same secret. Stateless — no DB
// round-trip, no cross-service import.
//
// MIRROR: realtime/src/lib/token.ts must keep this algorithm byte-for-byte identical.
// Change one, change the other in the same commit (same rule as desktop/PROTOCOL.md).

const VERSION = "v1";

export interface RealtimeClaims {
  tid: string; // tenant id
  uid: string; // user id
  role: string; // membership role
  iat: number; // issued-at (unix seconds)
  exp: number; // expiry (unix seconds)
  jti: string; // token id (uniqueness / tracing)
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signRealtimeToken(
  claims: { tid: string; uid: string; role: string },
  secret: string,
  ttlSeconds = 300,
  nowMs = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: RealtimeClaims = {
    tid: claims.tid,
    uid: claims.uid,
    role: claims.role,
    iat,
    exp: iat + ttlSeconds,
    jti: b64url(randomBytes(12)),
  };
  const body = VERSION + "." + b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return body + "." + b64url(hmac(secret, body));
}

export function verifyRealtimeToken(token: string, secret: string, nowMs = Date.now()): RealtimeClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [version, payloadB64, sigB64] = parts;
  if (version !== VERSION) throw new Error("unsupported token version");

  const expected = hmac(secret, version + "." + payloadB64);
  const got = b64urlToBuf(sigB64);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error("bad signature");
  }

  let claims: RealtimeClaims;
  try {
    claims = JSON.parse(b64urlToBuf(payloadB64).toString("utf8"));
  } catch {
    throw new Error("bad payload");
  }
  if (typeof claims.exp !== "number" || Math.floor(nowMs / 1000) >= claims.exp) {
    throw new Error("token expired");
  }
  if (!claims.tid || !claims.uid) throw new Error("incomplete claims");
  return claims;
}
