import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for per-tenant provider tokens (Fathom/Slack keys) at rest.
const ALGO = "aes-256-gcm";

function loadKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 32-byte hex (64 chars). Generate: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

// Returns "iv.tag.ciphertext" (all base64). Authenticated — tampering fails on decrypt.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB, tagB, ctB] = payload.split(".");
  if (!ivB || !tagB || !ctB) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv(ALGO, loadKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
