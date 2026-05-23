import type { IncomingMessage, ServerResponse } from "node:http";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type DeepSeekModel = "deepseek-v4-pro" | "deepseek-v4-flash";
export type ThinkingMode = "enabled" | "disabled";
export type ReasoningEffort = "high" | "max";

export interface ProxyConfig {
  host: string;
  port: number;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  defaultModel: DeepSeekModel;
  thinking: ThinkingMode;
  reasoningEffort: ReasoningEffort;
  logLevel: LogLevel;
}

export interface Logger {
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
}

export interface ResponsesRequest {
  model?: string;
  instructions?: string;
  input?: unknown;
  tools?: unknown[];
  reasoning?: { effort?: string } | null;
  max_output_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  reasoning_content?: string;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface DeepSeekChatRequest {
  model: DeepSeekModel;
  messages: ChatMessage[];
  stream: boolean;
  tools?: ChatTool[];
  tool_choice?: unknown;
  thinking: { type: ThinkingMode };
  reasoning_effort?: ReasoningEffort;
  max_tokens?: number;
}

export interface DeepSeekChatChunk {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: string | null;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: TokenUsage | null;
}

export interface DeepSeekChatCompletion {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ChatToolCall[];
    };
  }>;
  usage?: TokenUsage;
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface ResponseOutputText {
  type: "output_text";
  text: string;
  annotations: unknown[];
}

export interface ResponseMessageItem {
  id: string;
  type: "message";
  status: "in_progress" | "completed";
  role: "assistant";
  content: ResponseOutputText[];
}

export interface ResponseFunctionCallItem {
  id: string;
  type: "function_call";
  status: "in_progress" | "completed";
  call_id: string;
  name: string;
  arguments: string;
}

export type ResponseOutputItem = ResponseMessageItem | ResponseFunctionCallItem;

export interface ResponseObject {
  id: string;
  object: "response";
  created_at: number;
  status: "in_progress" | "completed" | "failed";
  model: string;
  output: ResponseOutputItem[];
  usage?: ResponsesUsage;
}
