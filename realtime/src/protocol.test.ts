import { describe, it, expect } from "bun:test";
import { parseControl, parseAudioFrame, audioAdmitted, initConn, msg } from "./protocol";

function frame(channel: number, tsMs: number, samples: number): Uint8Array {
  const buf = new Uint8Array(9 + samples * 2);
  const view = new DataView(buf.buffer);
  view.setUint8(0, channel);
  view.setBigUint64(1, BigInt(tsMs), true);
  return buf;
}

describe("control messages", () => {
  it("parses hello / consent / bye", () => {
    expect(
      parseControl(JSON.stringify({ type: "hello", session_token: "tok", platform: "macos", sample_rate: 16000 })).type,
    ).toBe("hello");
    expect(parseControl(JSON.stringify({ type: "consent", captured: true })).type).toBe("consent");
    expect(parseControl(JSON.stringify({ type: "bye" })).type).toBe("bye");
  });

  it("rejects an unknown type", () => {
    expect(() => parseControl(JSON.stringify({ type: "frobnicate" }))).toThrow();
  });

  it("rejects invalid json", () => {
    expect(() => parseControl("{not json")).toThrow();
  });

  it("rejects hello without a token", () => {
    expect(() => parseControl(JSON.stringify({ type: "hello" }))).toThrow();
  });
});

describe("audio frame", () => {
  it("parses a well-formed frame", () => {
    const f = parseAudioFrame(frame(1, 12345, 320));
    expect(f.channel).toBe(1);
    expect(f.tsMs).toBe(12345);
    expect(f.sampleCount).toBe(320);
  });

  it("rejects a short frame", () => {
    expect(() => parseAudioFrame(new Uint8Array(4))).toThrow();
  });

  it("rejects a bad channel", () => {
    expect(() => parseAudioFrame(frame(2, 0, 10))).toThrow();
  });

  it("rejects an odd PCM byte length", () => {
    expect(() => parseAudioFrame(new Uint8Array(9 + 3))).toThrow();
  });
});

describe("consent gate", () => {
  it("admits audio only once consented", () => {
    expect(audioAdmitted("greeting")).toBe(false);
    expect(audioAdmitted("ready")).toBe(false);
    expect(audioAdmitted("consented")).toBe(true);
    expect(audioAdmitted("closed")).toBe(false);
  });

  it("starts a connection in greeting with no session", () => {
    const c = initConn();
    expect(c.phase).toBe("greeting");
    expect(c.sessionId).toBeNull();
  });
});

describe("server->client cue frame (de-brand boundary)", () => {
  it("emits ONLY authored fields — no LLM free-text (reason/stage) reaches the wire", () => {
    const o = JSON.parse(
      msg.cue({ id: "abc", tier: "crit", text: "Lock the next step", category: "next_step", ttlMs: 8000, tsMs: 1000 }),
    );
    expect(Object.keys(o).sort()).toEqual(["category", "id", "text", "tier", "ts_ms", "ttl_ms", "type"]);
    expect(o).not.toHaveProperty("reason"); // internal LLM rationale must never be sent
    expect(o).not.toHaveProperty("stage");
    expect(msg.cue({ id: "1", tier: "help", text: "Ease in", category: null, ttlMs: 6000, tsMs: 0 })).not.toMatch(
      /nepq|jeremy\s*miner|7th\s*level|neuro-?emotional/i,
    );
  });
});
