import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isDesktop = process.env.DAMASCUS_DESKTOP === "1";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction || isDesktop
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
