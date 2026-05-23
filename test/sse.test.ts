import { describe, expect, it } from "vitest";
import { createResponseFromChatCompletion, createStreamTranslator, encodeSse } from "../src/sse.js";

describe("SSE translation", () => {
  it("translates DeepSeek text chunks into Responses lifecycle events", () => {
    const translator = createStreamTranslator("resp_test", "deepseek-v4-pro");
    const events = [
      ...translator.start(),
      ...translator.acceptChunk({
        id: "chunk_1",
        model: "deepseek-v4-pro",
        choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
      }),
      ...translator.acceptChunk({
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }),
      ...translator.finish(),
    ];

    expect(events.map((event) => event.type)).toContain("response.output_text.delta");
    expect(events.map((event) => event.type)).toContain("response.completed");
    expect(JSON.stringify(events.at(-1))).toContain("Hello");
    expect(encodeSse(events[0])).toMatch(/^event: response\.created/m);
  });

  it("translates DeepSeek tool call chunks into Responses function-call events", () => {
    const translator = createStreamTranslator("resp_test", "deepseek-v4-pro");
    const events = [
      ...translator.start(),
      ...translator.acceptChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "exec_command", arguments: "{\"cmd\"" },
                },
              ],
            },
          },
        ],
      }),
      ...translator.acceptChunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ":\"pwd\"}" },
                },
              ],
            },
          },
        ],
      }),
      ...translator.finish(),
    ];

    expect(events.map((event) => event.type)).toContain("response.function_call_arguments.delta");
    expect(events.map((event) => event.type)).toContain("response.function_call_arguments.done");
    expect(events.at(-1)).toMatchObject({
      response: {
        output: [
          {
            arguments: "{\"cmd\":\"pwd\"}",
          },
        ],
      },
    });
  });

  it("creates a completed Responses object for non-stream responses", () => {
    const response = createResponseFromChatCompletion(
      {
        id: "chat_1",
        created: 1,
        model: "deepseek-v4-pro",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      "deepseek-v4-pro",
    );

    expect(response.status).toBe("completed");
    expect(response.output[0]?.type).toBe("message");
    expect(response.usage?.total_tokens).toBe(2);
  });
});
