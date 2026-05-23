import type {
  DeepSeekChatCompletion,
  DeepSeekChatChunk,
  DeepSeekChatRequest,
  Logger,
  ProxyConfig,
} from "./types.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function fetchDeepSeekChat(
  chatRequest: DeepSeekChatRequest,
  config: ProxyConfig,
): Promise<Response> {
  const response = await fetch(joinUrl(config.deepseekBaseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify(chatRequest),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ProviderError(`DeepSeek request failed with HTTP ${response.status}`, response.status, body);
  }

  return response;
}

export async function readNonStreamCompletion(response: Response): Promise<DeepSeekChatCompletion> {
  return (await response.json()) as DeepSeekChatCompletion;
}

export async function* parseDeepSeekSse(
  stream: ReadableStream<Uint8Array>,
  logger?: Logger,
): AsyncGenerator<DeepSeekChatChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() || "";

      for (const part of parts) {
        const dataLines = part
          .split(/\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length === 0) {
          continue;
        }
        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          return;
        }
        try {
          yield JSON.parse(data) as DeepSeekChatChunk;
        } catch (error) {
          logger?.warn("Failed to parse upstream SSE chunk", { data, error: String(error) });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

