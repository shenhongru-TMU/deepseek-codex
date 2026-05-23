import { describe, expect, it, vi } from "vitest";
import { translateResponsesRequest } from "../src/translate.js";
import type { Logger, ProxyConfig } from "../src/types.js";

const config: ProxyConfig = {
  host: "127.0.0.1",
  port: 8787,
  deepseekApiKey: "test",
  deepseekBaseUrl: "https://api.deepseek.com",
  defaultModel: "deepseek-v4-pro",
  thinking: "enabled",
  reasoningEffort: "high",
  logLevel: "debug",
};

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("translateResponsesRequest", () => {
  it("converts instructions and input messages to DeepSeek chat messages", () => {
    const chat = translateResponsesRequest(
      {
        model: "deepseek-v4-pro",
        instructions: "You are helpful.",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        ],
      },
      config,
    );

    expect(chat.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(chat.model).toBe("deepseek-v4-pro");
    expect(chat.stream).toBe(true);
    expect(chat.thinking).toEqual({ type: "enabled" });
  });

  it("preserves function tools and filters unsupported tools", () => {
    const log = logger();
    const chat = translateResponsesRequest(
      {
        tools: [
          { type: "function", name: "exec_command", description: "Run command", parameters: { type: "object" } },
          { type: "web_search" },
          { type: "namespace", name: "mcp__node_repl__" },
        ],
      },
      config,
      log,
    );

    expect(chat.tools).toEqual([
      {
        type: "function",
        function: {
          name: "exec_command",
          description: "Run command",
          parameters: { type: "object" },
        },
      },
    ]);
    expect(log.debug).toHaveBeenCalledTimes(2);
  });

  it("maps reasoning effort and falls back unknown model names", () => {
    const chat = translateResponsesRequest(
      {
        model: "not-deepseek",
        reasoning: { effort: "xhigh" },
      },
      config,
    );

    expect(chat.model).toBe("deepseek-v4-pro");
    expect(chat.reasoning_effort).toBe("max");
  });

  it("converts function call output to a tool message", () => {
    const chat = translateResponsesRequest(
      {
        input: [
          {
            type: "function_call",
            call_id: "call_123",
            name: "exec_command",
            arguments: "{\"cmd\":\"pwd\"}",
          },
          {
            type: "function_call_output",
            call_id: "call_123",
            output: "done",
          },
        ],
      },
      config,
    );

    expect(chat.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "exec_command", arguments: "{\"cmd\":\"pwd\"}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_123", content: "done" },
    ]);
  });
});

