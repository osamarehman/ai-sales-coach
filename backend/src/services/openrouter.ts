import { config, requireOpenRouterKey } from "../config";

export interface ChatOptions {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
}

// Calls OpenRouter's OpenAI-compatible chat endpoint and returns the assistant text.
// Mirrors the n8n OpenRouter node: JSON response format, 64k max tokens, long timeout.
export async function chat(opts: ChatOptions): Promise<string> {
  const apiKey = requireOpenRouterKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 360_000);
  try {
    const res = await fetch(`${config.openRouter.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter attribution headers (optional but recommended).
        "HTTP-Referer": config.appUrl,
        "X-Title": "AI Sales Coach",
      },
      body: JSON.stringify({
        model: opts.model ?? config.openRouter.model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 64_000,
        ...(opts.jsonMode === false ? {} : { response_format: { type: "json_object" } }),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = (await res.json()) as ChatCompletion;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("OpenRouter returned no content");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
