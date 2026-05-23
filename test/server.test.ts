import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { createProxyServer } from "../src/server.js";
import type { ProxyConfig } from "../src/types.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

describe("proxy server", () => {
  it("streams a mocked DeepSeek response as Responses SSE", async () => {
    const upstream = await listen(
      createServer((req, res) => {
        expect(req.url).toBe("/chat/completions");
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl_1",
            model: "deepseek-v4-pro",
            choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })}\n\n`,
        );
        res.end("data: [DONE]\n\n");
      }),
    );

    const proxy = await listen(
      createProxyServer(
        {
          host: "127.0.0.1",
          port: 0,
          deepseekApiKey: "test",
          deepseekBaseUrl: `http://127.0.0.1:${addressPort(upstream)}`,
          defaultModel: "deepseek-v4-pro",
          thinking: "enabled",
          reasoningEffort: "high",
          logLevel: "error",
        } satisfies ProxyConfig,
        createLogger("error"),
      ),
    );

    const response = await fetch(`http://127.0.0.1:${addressPort(proxy)}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        instructions: "You are helpful.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("response.output_text.delta");
    expect(body).toContain("response.completed");
    expect(body).toContain("ok");
  });

  it("returns models and health checks", async () => {
    const proxy = await listen(
      createProxyServer(
        {
          host: "127.0.0.1",
          port: 0,
          deepseekApiKey: "test",
          deepseekBaseUrl: "http://127.0.0.1:1",
          defaultModel: "deepseek-v4-pro",
          thinking: "enabled",
          reasoningEffort: "high",
          logLevel: "error",
        },
        createLogger("error"),
      ),
    );

    const health = await fetch(`http://127.0.0.1:${addressPort(proxy)}/healthz`);
    expect(await health.json()).toEqual({ ok: true });

    const root = await fetch(`http://127.0.0.1:${addressPort(proxy)}/v1`);
    expect(await root.json()).toEqual({
      ok: true,
      service: "deepseek-codex-proxy",
      endpoints: ["/healthz", "/v1/models", "/v1/responses"],
    });

    const models = await fetch(`http://127.0.0.1:${addressPort(proxy)}/v1/models`);
    expect(await models.json()).toMatchObject({
      models: [{ slug: "deepseek-v4-pro" }, { slug: "deepseek-v4-flash" }],
    });
  });
});

async function listen(server: Server): Promise<Server> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function addressPort(server: Server): number {
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Expected TCP server address");
  }
  return address.port;
}
