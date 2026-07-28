import { describe, it, expect } from "bun:test";
import {
  fetchTranscript,
  createWebhook,
  deleteWebhook,
  listMeetings,
  FathomError,
} from "./fathom";

// Minimal fake of the fetch Response we use.
function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

// Fake fetch that records the request it was called with.
function capturingFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("fetchTranscript", () => {
  it("returns transcript JSON on 200", async () => {
    const tx = { transcript: [{ speaker: { display_name: "A" }, text: "hi", timestamp: "00:00:01" }] };
    const out = await fetchTranscript("123", "key", { fetchImpl: fakeFetch(200, tx) });
    expect(out).toEqual(tx);
  });

  it("throws FathomError on 401", async () => {
    await expect(
      fetchTranscript("123", "bad", { fetchImpl: fakeFetch(401, { error: "unauthorized" }) }),
    ).rejects.toBeInstanceOf(FathomError);
  });

  it("throws FathomError carrying the status on 404", async () => {
    await expect(
      fetchTranscript("x", "k", { fetchImpl: fakeFetch(404, {}) }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("createWebhook", () => {
  it("POSTs destination_url + an include flag and returns id/secret", async () => {
    const { impl, calls } = capturingFetch(201, { id: "wh_1", secret: "whsec_abc" });
    const out = await createWebhook("key", "https://app/api/webhooks/fathom/tok", {
      fetchImpl: impl,
    });
    expect(out).toEqual({ id: "wh_1", secret: "whsec_abc" });
    expect(calls[0].url).toEndWith("/webhooks");
    expect(calls[0].init.method).toBe("POST");
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.destination_url).toBe("https://app/api/webhooks/fathom/tok");
    expect(sent.include_summary).toBe(true);
    expect(sent.triggered_for).toContain("my_recordings");
  });

  it("throws if Fathom returns no id/secret", async () => {
    await expect(
      createWebhook("key", "https://app/hook", { fetchImpl: fakeFetch(201, {}) }),
    ).rejects.toBeInstanceOf(FathomError);
  });

  it("propagates a 401 as FathomError (bad key)", async () => {
    await expect(
      createWebhook("bad", "https://app/hook", { fetchImpl: fakeFetch(401, {}) }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("deleteWebhook", () => {
  it("treats 404 as already-deleted (no throw)", async () => {
    await expect(
      deleteWebhook("key", "gone", { fetchImpl: fakeFetch(404, {}) }),
    ).resolves.toBeUndefined();
  });

  it("rethrows other errors", async () => {
    await expect(
      deleteWebhook("key", "x", { fetchImpl: fakeFetch(500, {}) }),
    ).rejects.toBeInstanceOf(FathomError);
  });
});

describe("listMeetings", () => {
  it("normalizes items, passes the cursor, and carries next_cursor", async () => {
    const page = {
      next_cursor: "CUR2",
      items: [
        {
          recording_id: 987,
          title: "GAMEPLAN — Acme",
          created_at: "2026-07-01T10:00:00Z",
          share_url: "https://fathom.video/s/987",
          recorded_by: { email: "rep@acme.com", name: "Rep One" },
        },
        { title: "no id — dropped" }, // missing recording_id → filtered out
      ],
    };
    const { impl, calls } = capturingFetch(200, page);
    const out = await listMeetings("key", { cursor: "CUR1" }, { fetchImpl: impl });
    expect(calls[0].url).toContain("cursor=CUR1");
    expect(out.nextCursor).toBe("CUR2");
    expect(out.items).toEqual([
      {
        recordingId: "987",
        title: "GAMEPLAN — Acme",
        recordedByEmail: "rep@acme.com",
        recordedByName: "Rep One",
        createdAt: "2026-07-01T10:00:00Z",
        shareUrl: "https://fathom.video/s/987",
      },
    ]);
  });
});
