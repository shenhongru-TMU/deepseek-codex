#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createProxyServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = createProxyServer(config, logger);

  server.listen(config.port, config.host, () => {
    logger.info("DeepSeek Codex proxy listening", {
      url: `http://${config.host}:${config.port}`,
      upstream: config.deepseekBaseUrl,
      defaultModel: config.defaultModel,
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info("Shutting down", { signal });
      server.close(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

