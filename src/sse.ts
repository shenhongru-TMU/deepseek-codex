import type {
  ChatToolCall,
  DeepSeekChatChunk,
  DeepSeekChatCompletion,
  ResponseFunctionCallItem,
  ResponseMessageItem,
  ResponseObject,
  ResponseOutputItem,
  ResponsesUsage,
  TokenUsage,
} from "./types.js";
import { normalizeUsage } from "./translate.js";

export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

interface StreamState {
  responseId: string;
  model: string;
  createdAt: number;
  output: ResponseOutputItem[];
  textItem?: ResponseMessageItem;
  textStarted: boolean;
  text: string;
  reasoningContent: string;
  toolCalls: Map<number, ResponseFunctionCallItem>;
  usage?: ResponsesUsage;
  nextOutputIndex: number;
}

type DeepSeekToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

export function createInitialResponse(responseId: string, model: string, createdAt = nowSeconds()): ResponseObject {
  return {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    model,
    output: [],
  };
}

export function createResponseFromChatCompletion(
  completion: DeepSeekChatCompletion,
  modelFallback: string,
): ResponseObject {
  const responseId = completion.id || createId("resp");
  const createdAt = completion.created || nowSeconds();
  const model = completion.model || modelFallback;
  const output: ResponseOutputItem[] = [];
  const choice = completion.choices?.[0];
  const message = choice?.message;

  if (message?.tool_calls?.length) {
    for (const call of message.tool_calls) {
      output.push(createFunctionCallItem(call, output.length, "completed"));
    }
  } else {
    output.push({
      id: createId("msg"),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: message?.content || "",
          annotations: [],
        },
      ],
    });
  }

  return {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model,
    output,
    usage: normalizeUsage(completion.usage),
  };
}

export function createStreamTranslator(responseId: string, model: string): {
  start: () => SseEvent[];
  acceptChunk: (chunk: DeepSeekChatChunk) => SseEvent[];
  finish: () => SseEvent[];
  getReasoningContentByCallId: () => Map<string, string>;
} {
  const state: StreamState = {
    responseId,
    model,
    createdAt: nowSeconds(),
    output: [],
    textStarted: false,
    text: "",
    reasoningContent: "",
    toolCalls: new Map(),
    nextOutputIndex: 0,
  };

  return {
    start: () => [
      {
        type: "response.created",
        response: createInitialResponse(state.responseId, state.model, state.createdAt),
      },
    ],
    acceptChunk: (chunk) => acceptChunk(state, chunk),
    finish: () => finishStream(state),
    getReasoningContentByCallId: () => getReasoningContentByCallId(state),
  };
}

export function encodeSse(event: SseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createErrorEvent(message: string, status = 500): SseEvent {
  return {
    type: "error",
    error: {
      message,
      type: "deepseek_proxy_error",
      code: status,
    },
  };
}

function acceptChunk(state: StreamState, chunk: DeepSeekChatChunk): SseEvent[] {
  const events: SseEvent[] = [];
  if (chunk.id) {
    state.responseId = chunk.id;
  }
  if (chunk.model) {
    state.model = chunk.model;
  }
  if (chunk.created) {
    state.createdAt = chunk.created;
  }
  if (chunk.usage) {
    state.usage = normalizeUsage(chunk.usage);
  }

  for (const choice of chunk.choices || []) {
    const delta = choice.delta;
    if (!delta) {
      continue;
    }

    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      state.reasoningContent += delta.reasoning_content;
      continue;
    }

    if (typeof delta.content === "string" && delta.content.length > 0) {
      events.push(...acceptTextDelta(state, delta.content));
    }

    for (const toolCall of delta.tool_calls || []) {
      events.push(...acceptToolCallDelta(state, toolCall));
    }
  }

  return events;
}

function acceptTextDelta(state: StreamState, delta: string): SseEvent[] {
  const events: SseEvent[] = [];
  if (!state.textItem) {
    state.textItem = {
      id: createId("msg"),
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: [],
    };
    state.output.push(state.textItem);
    events.push({
      type: "response.output_item.added",
      output_index: state.output.length - 1,
      item: state.textItem,
    });
  }

  if (!state.textStarted) {
    state.textStarted = true;
    events.push({
      type: "response.content_part.added",
      item_id: state.textItem.id,
      output_index: state.output.indexOf(state.textItem),
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  }

  state.text += delta;
  events.push({
    type: "response.output_text.delta",
    item_id: state.textItem.id,
    output_index: state.output.indexOf(state.textItem),
    content_index: 0,
    delta,
  });

  return events;
}

function acceptToolCallDelta(
  state: StreamState,
  toolCall: DeepSeekToolCallDelta,
): SseEvent[] {
  const index = toolCall.index ?? 0;
  let item = state.toolCalls.get(index);
  const events: SseEvent[] = [];

  if (!item) {
    item = {
      id: toolCall.id || createId("fc"),
      type: "function_call",
      status: "in_progress",
      call_id: toolCall.id || createId("call"),
      name: toolCall.function?.name || "",
      arguments: "",
    };
    state.toolCalls.set(index, item);
    state.output.push(item);
    events.push({
      type: "response.output_item.added",
      output_index: state.output.length - 1,
      item,
    });
  }

  if (toolCall.id) {
    item.id = toolCall.id;
    item.call_id = toolCall.id;
  }
  if (toolCall.function?.name) {
    item.name = toolCall.function.name;
  }
  if (toolCall.function?.arguments) {
    item.arguments += toolCall.function.arguments;
    events.push({
      type: "response.function_call_arguments.delta",
      item_id: item.id,
      output_index: state.output.indexOf(item),
      delta: toolCall.function.arguments,
    });
  }

  return events;
}

function finishStream(state: StreamState): SseEvent[] {
  const events: SseEvent[] = [];

  if (state.textItem) {
    state.textItem.status = "completed";
    state.textItem.content = [{ type: "output_text", text: state.text, annotations: [] }];
    const outputIndex = state.output.indexOf(state.textItem);
    events.push({
      type: "response.output_text.done",
      item_id: state.textItem.id,
      output_index: outputIndex,
      content_index: 0,
      text: state.text,
    });
    events.push({
      type: "response.content_part.done",
      item_id: state.textItem.id,
      output_index: outputIndex,
      content_index: 0,
      part: state.textItem.content[0],
    });
    events.push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: state.textItem,
    });
  }

  for (const item of state.toolCalls.values()) {
    item.status = "completed";
    const outputIndex = state.output.indexOf(item);
    events.push({
      type: "response.function_call_arguments.done",
      item_id: item.id,
      output_index: outputIndex,
      arguments: item.arguments,
    });
    events.push({
      type: "response.output_item.done",
      output_index: outputIndex,
      item,
    });
  }

  events.push({
    type: "response.completed",
    response: {
      id: state.responseId,
      object: "response",
      created_at: state.createdAt,
      status: "completed",
      model: state.model,
      output: state.output,
      usage: state.usage || emptyUsage(),
    } satisfies ResponseObject,
  });

  return events;
}

function createFunctionCallItem(
  call: ChatToolCall,
  index: number,
  status: "in_progress" | "completed",
): ResponseFunctionCallItem {
  return {
    id: call.id || createId(`fc_${index}`),
    type: "function_call",
    status,
    call_id: call.id || createId(`call_${index}`),
    name: call.function.name,
    arguments: call.function.arguments,
  };
}

function getReasoningContentByCallId(state: StreamState): Map<string, string> {
  const byCallId = new Map<string, string>();
  const reasoningContent = state.reasoningContent.trim();
  if (!reasoningContent) {
    return byCallId;
  }

  for (const item of state.toolCalls.values()) {
    byCallId.set(item.call_id, reasoningContent);
  }

  return byCallId;
}

function emptyUsage(): ResponsesUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

export function usageFromChunk(chunk: { usage?: TokenUsage | null }): ResponsesUsage {
  return normalizeUsage(chunk.usage || undefined);
}
