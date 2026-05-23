import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { buildModelsResponse } from "./models.js";
import { createErrorEvent, createResponseFromChatCompletion, createStreamTranslator, encodeSse } from "./sse.js";
import { translateResponsesRequest } from "./translate.js";
import type { Logger, ProxyConfig, ResponsesRequest } from "./types.js";
import { fetchDeepSeekChat, parseDeepSeekSse, ProviderError, readNonStreamCompletion } from "./upstream.js";

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_REASONING_SESSIONS = 100;

type ReasoningStore = Map<string, Map<string, string>>;

export function createProxyServer(config: ProxyConfig, logger: Logger): Server {
  const reasoningStore: ReasoningStore = new Map();

  return createHttpServer(async (req, res) => {
    try {
      await routeRequest(req, res, config, logger, reasoningStore);
    } catch (error) {
      logger.error("Unhandled request error", { error: errorToString(error) });
      if (!res.headersSent) {
        sendJson(res, 500, openAiError("Internal proxy error", 500));
      } else {
        res.end();
      }
    }
  });
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ProxyConfig,
  logger: Logger,
  reasoningStore: ReasoningStore,
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1") {
    sendJson(res, 200, {
      ok: true,
      service: "deepseek-codex-proxy",
      endpoints: ["/healthz", "/v1/models", "/v1/responses"],
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    sendJson(res, 200, buildModelsResponse());
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    await handleResponses(req, res, config, logger, reasoningStore);
    return;
  }

  sendJson(res, 404, openAiError(`No route for ${req.method || "GET"} ${url.pathname}`, 404));
}

async function handleResponses(
  req: IncomingMessage,
  res: ServerResponse,
  config: ProxyConfig,
  logger: Logger,
  reasoningStore: ReasoningStore,
): Promise<void> {
  let request: ResponsesRequest;
  try {
    request = JSON.parse(await readBody(req)) as ResponsesRequest;
  } catch (error) {
    sendJson(res, 400, openAiError(`Invalid JSON request: ${errorToString(error)}`, 400));
    return;
  }

  const sessionKey = getSessionKey(req);
  const chatRequest = translateResponsesRequest(request, config, logger, reasoningStore.get(sessionKey));
  logger.debug("Translated Responses request", {
    model: chatRequest.model,
    messageCount: chatRequest.messages.length,
    toolCount: chatRequest.tools?.length || 0,
    stream: chatRequest.stream,
  });

  if (chatRequest.stream) {
    await handleStreamingResponse(res, chatRequest, config, logger, reasoningStore, sessionKey);
    return;
  }

  await handleJsonResponse(res, chatRequest, config);
}

async function handleStreamingResponse(
  res: ServerResponse,
  chatRequest: ReturnType<typeof translateResponsesRequest>,
  config: ProxyConfig,
  logger: Logger,
  reasoningStore: ReasoningStore,
  sessionKey: string,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  try {
    const upstream = await fetchDeepSeekChat(chatRequest, config);
    if (!upstream.body) {
      throw new ProviderError("DeepSeek returned an empty stream", 502);
    }

    const translator = createStreamTranslator(`resp_${Date.now().toString(36)}`, chatRequest.model);
    for (const event of translator.start()) {
      res.write(encodeSse(event));
    }

    for await (const chunk of parseDeepSeekSse(upstream.body, logger)) {
      for (const event of translator.acceptChunk(chunk)) {
        res.write(encodeSse(event));
      }
    }

    const finishEvents = translator.finish();
    mergeReasoningContent(reasoningStore, sessionKey, translator.getReasoningContentByCallId());
    for (const event of finishEvents) {
      res.write(encodeSse(event));
    }
    res.end();
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500;
    const message = error instanceof ProviderError ? `${error.message}${error.body ? `: ${error.body}` : ""}` : errorToString(error);
    logger.error("Streaming response failed", { status, message });
    res.write(encodeSse(createErrorEvent(message, status)));
    res.end();
  }
}

async function handleJsonResponse(
  res: ServerResponse,
  chatRequest: ReturnType<typeof translateResponsesRequest>,
  config: ProxyConfig,
): Promise<void> {
  try {
    const upstream = await fetchDeepSeekChat(chatRequest, config);
    const completion = await readNonStreamCompletion(upstream);
    sendJson(res, 200, createResponseFromChatCompletion(completion, chatRequest.model));
  } catch (error) {
    if (error instanceof ProviderError) {
      sendJson(res, error.status, openAiError(`${error.message}${error.body ? `: ${error.body}` : ""}`, error.status));
      return;
    }
    sendJson(res, 500, openAiError(errorToString(error), 500));
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function openAiError(message: string, status: number): { error: { message: string; type: string; code: number } } {
  return {
    error: {
      message,
      type: "deepseek_proxy_error",
      code: status,
    },
  };
}

function getSessionKey(req: IncomingMessage): string {
  return (
    getHeader(req, "session-id") ||
    getHeader(req, "thread-id") ||
    getHeader(req, "x-client-request-id") ||
    "default"
  );
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function mergeReasoningContent(
  store: ReasoningStore,
  sessionKey: string,
  reasoningContentByCallId: Map<string, string>,
): void {
  if (reasoningContentByCallId.size === 0) {
    return;
  }

  let sessionStore = store.get(sessionKey);
  if (!sessionStore) {
    sessionStore = new Map();
    store.set(sessionKey, sessionStore);
  }

  for (const [callId, reasoningContent] of reasoningContentByCallId) {
    sessionStore.set(callId, reasoningContent);
  }

  while (store.size > MAX_REASONING_SESSIONS) {
    const firstKey = store.keys().next().value;
    if (!firstKey) {
      break;
    }
    store.delete(firstKey);
  }
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
