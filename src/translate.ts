import type {
  ChatMessage,
  ChatTool,
  DeepSeekChatCompletion,
  DeepSeekChatRequest,
  DeepSeekModel,
  Logger,
  ProxyConfig,
  ResponsesRequest,
  ResponsesUsage,
} from "./types.js";

const DEEPSEEK_MODELS = new Set<DeepSeekModel>(["deepseek-v4-pro", "deepseek-v4-flash"]);

export function translateResponsesRequest(
  request: ResponsesRequest,
  config: ProxyConfig,
  logger?: Logger,
  reasoningContentByCallId?: ReadonlyMap<string, string>,
): DeepSeekChatRequest {
  const messages: ChatMessage[] = [];
  if (typeof request.instructions === "string" && request.instructions.trim()) {
    messages.push({ role: "system", content: request.instructions });
  }

  messages.push(...translateInput(request.input, reasoningContentByCallId));

  const tools = translateTools(request.tools, logger);
  const chatRequest: DeepSeekChatRequest = {
    model: normalizeModel(request.model, config.defaultModel),
    messages,
    stream: request.stream !== false,
    thinking: { type: config.thinking },
  };

  if (config.thinking === "enabled") {
    chatRequest.reasoning_effort = mapReasoningEffort(request.reasoning?.effort, config.reasoningEffort);
  }

  if (tools.length > 0) {
    chatRequest.tools = tools;
    if (request.tool_choice !== undefined) {
      chatRequest.tool_choice = request.tool_choice;
    }
  }

  if (typeof request.max_output_tokens === "number") {
    chatRequest.max_tokens = request.max_output_tokens;
  }

  return chatRequest;
}

export function translateInput(
  input: unknown,
  reasoningContentByCallId: ReadonlyMap<string, string> = new Map(),
): ChatMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  const messages: ChatMessage[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "message") {
      const role = normalizeMessageRole(item.role);
      if (!role) {
        continue;
      }
      messages.push({
        role,
        content: extractTextContent(item.content),
      });
      continue;
    }

    if (item.type === "function_call") {
      const name = stringValue(item.name) || "unknown_function";
      const callId = stringValue(item.call_id) || stringValue(item.id) || `call_${messages.length}`;
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name,
              arguments: stringifyArguments(item.arguments),
            },
          },
        ],
      };
      const reasoningContent = reasoningContentByCallId.get(callId);
      if (reasoningContent) {
        assistantMessage.reasoning_content = reasoningContent;
      }
      messages.push(assistantMessage);
      continue;
    }

    if (item.type === "function_call_output") {
      const callId = stringValue(item.call_id) || `call_${messages.length}`;
      messages.push({
        role: "tool",
        tool_call_id: callId,
        content: stringifyToolOutput(item.output),
      });
    }
  }

  return messages;
}

export function translateTools(tools: unknown[] | undefined, logger?: Logger): ChatTool[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  const translated: ChatTool[] = [];
  for (const tool of tools) {
    if (!isRecord(tool)) {
      continue;
    }

    if (tool.type !== "function") {
      logger?.debug("Filtering unsupported Codex tool", { type: tool.type, name: tool.name });
      continue;
    }

    if (isRecord(tool.function)) {
      const name = stringValue(tool.function.name);
      if (!name) {
        continue;
      }
      translated.push({
        type: "function",
        function: {
          name,
          description: stringValue(tool.function.description),
          parameters: tool.function.parameters,
        },
      });
      continue;
    }

    const name = stringValue(tool.name);
    if (!name) {
      continue;
    }
    translated.push({
      type: "function",
      function: {
        name,
        description: stringValue(tool.description),
        parameters: tool.parameters,
      },
    });
  }

  return translated;
}

export function mapReasoningEffort(value: string | undefined, fallback: "high" | "max"): "high" | "max" {
  if (value === "xhigh") {
    return "max";
  }
  if (value === "high" || value === "medium" || value === "low") {
    return "high";
  }
  return fallback;
}

export function normalizeUsage(usage: DeepSeekChatCompletion["usage"]): ResponsesUsage {
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
  const cachedTokens = usage?.prompt_cache_hit_tokens;
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    ...(cachedTokens === undefined ? {} : { input_tokens_details: { cached_tokens: cachedTokens } }),
    ...(reasoningTokens === undefined
      ? {}
      : { output_tokens_details: { reasoning_tokens: reasoningTokens } }),
  };
}

function normalizeModel(model: string | undefined, fallback: DeepSeekModel): DeepSeekModel {
  if (model && DEEPSEEK_MODELS.has(model as DeepSeekModel)) {
    return model as DeepSeekModel;
  }
  return fallback;
}

function normalizeMessageRole(role: unknown): ChatMessage["role"] | null {
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content == null ? "" : JSON.stringify(content);
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (!isRecord(part)) {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.content === "string") {
        return part.content;
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

function stringifyArguments(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? {});
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? "");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
