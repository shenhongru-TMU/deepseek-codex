import type { LogLevel, Logger } from "./types.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level: LogLevel): Logger {
  function write(messageLevel: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[messageLevel] < LEVEL_ORDER[level]) {
      return;
    }

    const payload = {
      time: new Date().toISOString(),
      level: messageLevel,
      message,
      ...(meta === undefined ? {} : { meta }),
    };
    const line = JSON.stringify(payload);
    if (messageLevel === "error") {
      console.error(line);
    } else if (messageLevel === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
  };
}

