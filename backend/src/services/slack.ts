export class SlackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackError";
  }
}

export interface SlackPostArgs {
  botToken: string;
  channelId: string;
  blocks: unknown[];
  text: string; // fallback text for notifications/accessibility
  threadTs?: string;
  fetchImpl?: typeof fetch; // injectable for tests
}

// chat.postMessage. Returns the message ts (used as the thread root for replies).
export async function postMessage(args: SlackPostArgs): Promise<{ ts: string }> {
  const doFetch = args.fetchImpl ?? fetch;
  const res = await doFetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: args.channelId,
      text: args.text,
      blocks: args.blocks,
      ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
    }),
  });
  const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  if (!data.ok) throw new SlackError(`Slack API error: ${data.error ?? "unknown"}`);
  return { ts: data.ts ?? "" };
}
