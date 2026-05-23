import type { DeepSeekModel, LogLevel, ProxyConfig, ReasoningEffort, ThinkingMode } from "./types.js";

const MODELS = new Set<DeepSeekModel>(["deepseek-v4-pro", "deepseek-v4-flash"]);
const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required");
  }

  return {
    host: env.HOST || "127.0.0.1",
    port: parsePort(env.PORT),
    deepseekApiKey: apiKey,
    deepseekBaseUrl: stripTrailingSlash(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
    defaultModel: parseModel(env.DEEPSEEK_DEFAULT_MODEL || "deepseek-v4-pro"),
    thinking: parseThinking(env.DEEPSEEK_THINKING || "enabled"),
    reasoningEffort: parseReasoningEffort(env.DEEPSEEK_REASONING_EFFORT || "high"),
    logLevel: parseLogLevel(env.LOG_LEVEL || "info"),
  };
}

function parsePort(value: string | undefined): number {
  const port = Number(value || "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function parseModel(value: string): DeepSeekModel {
  if (MODELS.has(value as DeepSeekModel)) {
    return value as DeepSeekModel;
  }
  throw new Error(`Invalid DEEPSEEK_DEFAULT_MODEL: ${value}`);
}

function parseThinking(value: string): ThinkingMode {
  if (value === "enabled" || value === "disabled") {
    return value;
  }
  throw new Error(`Invalid DEEPSEEK_THINKING: ${value}`);
}

function parseReasoningEffort(value: string): ReasoningEffort {
  if (value === "high" || value === "max") {
    return value;
  }
  throw new Error(`Invalid DEEPSEEK_REASONING_EFFORT: ${value}`);
}

function parseLogLevel(value: string): LogLevel {
  if (LOG_LEVELS.has(value as LogLevel)) {
    return value as LogLevel;
  }
  throw new Error(`Invalid LOG_LEVEL: ${value}`);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

