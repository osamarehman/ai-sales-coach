import { describe, expect, it } from "bun:test";
import {
  parseScribeMessage,
  toTranscriptSegment,
  buildScribeUrl,
  startStt,
  type SocketFactory,
  type SocketHandlers,
  type SttSocket,
} from "./stt";

describe("parseScribeMessage", () => {
  it("reads session_started", () => {
    const ev = parseScribeMessage(JSON.stringify({ message_type: "session_started", session_id: "s1" }));
    expect(ev).toEqual({ kind: "ready", sessionId: "s1" });
  });

  it("reads a partial transcript", () => {
    const ev = parseScribeMessage(JSON.stringify({ message_type: "partial_transcript", text: "hel" }));
    expect(ev).toEqual({ kind: "partial", text: "hel" });
  });

  it("reads a committed transcript with word timestamps (span across word entries)", () => {
    const ev = parseScribeMessage(
      JSON.stringify({
        message_type: "committed_transcript_with_timestamps",
        text: "hello there",
        words: [
          { text: "hello", start: 1.0, end: 1.4, type: "word" },
          { text: " ", start: 1.4, end: 1.5, type: "spacing" }, // skipped
          { text: "there", start: 1.5, end: 2.0, type: "word" },
        ],
      }),
    );
    expect(ev).toEqual({ kind: "segment", text: "hello there", startSec: 1.0, endSec: 2.0 });
  });

  it("treats a committed transcript without words as a segment with a null span", () => {
    const ev = parseScribeMessage(JSON.stringify({ message_type: "committed_transcript", text: "hi" }));
    expect(ev).toEqual({ kind: "segment", text: "hi", startSec: null, endSec: null });
  });

  it("ignores unknown types, non-objects, and malformed JSON", () => {
    expect(parseScribeMessage(JSON.stringify({ message_type: "vad_score", score: 0.2 })).kind).toBe("ignore");
    expect(parseScribeMessage("not json").kind).toBe("ignore");
    expect(parseScribeMessage(JSON.stringify(["array"])).kind).toBe("ignore");
    expect(parseScribeMessage("null").kind).toBe("ignore");
  });

  it("guards garbled word timings without throwing", () => {
    const ev = parseScribeMessage(
      JSON.stringify({
        message_type: "final_transcript_with_timestamps",
        text: "ok",
        words: [
          { text: "ok", start: "bad", end: 3.2, type: "word" }, // start non-finite => ignored
          null, // not an object => skipped
          { text: "x", start: 0.5, end: "nope", type: "word" }, // end non-finite => ignored
        ],
      }),
    );
    expect(ev).toEqual({ kind: "segment", text: "ok", startSec: 0.5, endSec: 3.2 });
  });
});

describe("toTranscriptSegment", () => {
  it("anchors endMs to the last audio ts and derives duration from the word span", () => {
    const seg = toTranscriptSegment(
      { text: "hello there", startSec: 1.0, endSec: 2.0 },
      { speaker: "rep", lastTsMs: 30_000 },
    );
    expect(seg).toEqual({ speaker: "rep", text: "hello there", startMs: 29_000, endMs: 30_000, final: true });
  });

  it("uses a zero-length span when timestamps are missing", () => {
    const seg = toTranscriptSegment({ text: "hi", startSec: null, endSec: null }, { speaker: "prospect", lastTsMs: 5_000 });
    expect(seg).toEqual({ speaker: "prospect", text: "hi", startMs: 5_000, endMs: 5_000, final: true });
  });

  it("drops empty / whitespace-only text", () => {
    expect(toTranscriptSegment({ text: "   ", startSec: 0, endSec: 1 }, { speaker: "rep", lastTsMs: 1000 })).toBeNull();
  });

  it("never produces negative timestamps (duration longer than the elapsed clock clamps to 0)", () => {
    const seg = toTranscriptSegment({ text: "x", startSec: 0, endSec: 10 }, { speaker: "rep", lastTsMs: 2000 });
    expect(seg).toEqual({ speaker: "rep", text: "x", startMs: 0, endMs: 2000, final: true });
  });
});

describe("buildScribeUrl", () => {
  it("sets the RT-2 query params (vad commit, timestamps, auto-detect, zero-retention)", () => {
    const url = new URL(buildScribeUrl("scribe_v2_realtime"));
    expect(url.searchParams.get("model_id")).toBe("scribe_v2_realtime");
    expect(url.searchParams.get("audio_format")).toBe("pcm_16000");
    expect(url.searchParams.get("commit_strategy")).toBe("vad");
    expect(url.searchParams.get("include_timestamps")).toBe("true");
    expect(url.searchParams.get("include_language_detection")).toBe("true");
    expect(url.searchParams.get("enable_logging")).toBe("false");
  });
});

// A controllable fake socket so the relay is testable with no network.
function fakeFactory() {
  const sockets: Array<{
    url: string;
    apiKey: string;
    handlers: SocketHandlers;
    sent: string[];
    closed: boolean;
  }> = [];
  const factory: SocketFactory = (url, apiKey, handlers) => {
    const rec = { url, apiKey, handlers, sent: [] as string[], closed: false };
    sockets.push(rec);
    const sock: SttSocket = {
      send: (d) => rec.sent.push(d),
      close: () => {
        rec.closed = true;
      },
    };
    return sock;
  };
  return { factory, sockets };
}

describe("startStt", () => {
  it("opens one session per channel, tags the speaker, and emits a segment on a committed message", () => {
    const { factory, sockets } = fakeFactory();
    const got: Array<{ speaker: string; text: string; endMs: number }> = [];
    const stt = startStt({
      apiKey: "k",
      onSegment: (seg) => {
        got.push({ speaker: seg.speaker, text: seg.text, endMs: seg.endMs });
      },
      factory,
    });

    // channel 0 (rep): before the socket opens, audio is DROPPED (not sent)
    stt.feed(0, new Uint8Array([1, 2]), 1000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].apiKey).toBe("k");
    expect(sockets[0].sent).toHaveLength(0);

    // once open, audio flows as base64 input_audio_chunk messages
    sockets[0].handlers.onOpen();
    stt.feed(0, new Uint8Array([3, 4]), 2000);
    expect(sockets[0].sent).toHaveLength(1);
    const chunk = JSON.parse(sockets[0].sent[0]);
    expect(chunk.message_type).toBe("input_audio_chunk");
    expect(chunk.audio_base_64).toBe(Buffer.from(new Uint8Array([3, 4])).toString("base64"));

    // a committed transcript => one rep segment, endMs anchored to the last ts (2000)
    sockets[0].handlers.onMessage(
      JSON.stringify({
        message_type: "committed_transcript_with_timestamps",
        text: "we help teams",
        words: [
          { text: "we", start: 0.5, end: 0.7, type: "word" },
          { text: "teams", start: 0.7, end: 1.0, type: "word" },
        ],
      }),
    );
    expect(got).toEqual([{ speaker: "rep", text: "we help teams", endMs: 2000 }]);

    // same channel reuses the session; a new channel opens a second (prospect) session
    stt.feed(0, new Uint8Array([5]), 3000);
    expect(sockets).toHaveLength(1);
    stt.feed(1, new Uint8Array([6]), 3100);
    expect(sockets).toHaveLength(2);
    sockets[1].handlers.onOpen();
    sockets[1].handlers.onMessage(JSON.stringify({ message_type: "committed_transcript", text: "sounds good" }));
    expect(got[1]).toEqual({ speaker: "prospect", text: "sounds good", endMs: 3100 });
  });

  it("closes every underlying socket and does not reconnect after close()", () => {
    const { factory, sockets } = fakeFactory();
    const stt = startStt({ apiKey: "k", onSegment: () => {}, factory });
    stt.feed(0, new Uint8Array([1]), 100);
    stt.feed(1, new Uint8Array([2]), 200);
    expect(sockets).toHaveLength(2);

    stt.close();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].closed).toBe(true);

    // a late close event from the network must NOT trigger a reconnect once we've closed
    sockets[0].handlers.onClose();
    expect(sockets).toHaveLength(2);
  });

  it("reconnects after an unexpected socket close", async () => {
    const { factory, sockets } = fakeFactory();
    const stt = startStt({ apiKey: "k", onSegment: () => {}, factory });
    stt.feed(0, new Uint8Array([1]), 100);
    expect(sockets).toHaveLength(1);
    sockets[0].handlers.onOpen();

    // simulate the network dropping the socket; first backoff is RECONNECT_BASE_MS (500ms)
    sockets[0].handlers.onClose();
    await new Promise((r) => setTimeout(r, 700));
    expect(sockets.length).toBeGreaterThanOrEqual(2); // a fresh socket was opened
    stt.close();
  });
});
