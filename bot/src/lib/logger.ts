import winston from "winston";

const level = process.env.NODE_ENV === "production" ? "warn" : "debug";

const base = winston.createLogger({
  level,
  levels: { error: 0, warn: 1, info: 2, debug: 3, trace: 4 },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, module: mod, ...meta }) => {
      const data = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `${timestamp} [${level.toUpperCase()}] [${mod ?? "bot"}] ${message}${data}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

export function logger(module: string) {
  return {
    error: (message: string, meta?: Record<string, unknown>) => base.error(message, { module, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) => base.warn(message, { module, ...meta }),
    info: (message: string, meta?: Record<string, unknown>) => base.info(message, { module, ...meta }),
    debug: (message: string, meta?: Record<string, unknown>) => base.debug(message, { module, ...meta }),
  };
}
