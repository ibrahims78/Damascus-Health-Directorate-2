import express, { type Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { desktopMode, pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { startAlertWorker } from "./lib/alert-worker";
import { csrfProtect } from "./lib/csrf";
import "./types/session.d.ts";

// ── Enforce SESSION_SECRET in production ─────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  logger.error("SESSION_SECRET environment variable is required in production. Exiting.");
  process.exit(1);
}

const app: Express = express();

app.set("trust proxy", 1);

// Security headers (helmet). CSP keeps the SPA fully functional (inline
// styles are required by React/Radix; ws/wss for HMR and SSE) while blocking
// foreign script/frame sources. upgrade-insecure-requests stays off because
// the Electron desktop build serves over loopback HTTP.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── CORS: restrict to same-origin and known Replit preview/deployment domains.
// Preview URLs may include an extra routing label, e.g. *.picard.replit.dev.
const allowedOriginPattern =
  /^(?:https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|(?:192\.168|10|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+(?::\d+)?)|https:\/\/(?:[a-z0-9-]+\.)+replit\.(?:dev|app))$/i;
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server (no Origin header) and same-origin requests
      if (!origin) return callback(null, true);
      if (allowedOriginPattern.test(origin)) return callback(null, true);
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    credentials: true,
  }),
);

// Large JSON bodies are only accepted where they are legitimately needed
// (encrypted package uploads and bulk imports). Everything else is capped at
// 2 MB so oversized requests cannot be used to exhaust server memory.
app.use(
  [
    "/api/backups",
    "/api/backup",
    "/api/sync/import",
    "/api/sync/exchange",
    "/api/items/bulk-import",
    "/api/equipment/bulk-import",
  ],
  express.json({ limit: "64mb" }),
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const PgSession = connectPgSimple(session);
const sessionStore = desktopMode
  ? undefined
  : new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    });

app.use(
  session({
    ...(sessionStore ? { store: sessionStore } : {}),
    secret: sessionSecret || "fallback-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      // The embedded Electron API is served over loopback HTTP. A Secure
      // cookie would be rejected by Chromium there, which makes setup/login
      // appear successful while every subsequent protected request is 401.
      secure: process.env.NODE_ENV === "production" && !desktopMode,
      httpOnly: true,
      // Strict (was lax): with the synchronizer-token CSRF protection in
      // place, strict SameSite closes the remaining cross-site cookie
      // leaks without breaking same-origin SPA usage.
      sameSite: "strict",
      // 24h with sliding renewal (rolling: true) instead of a static 7-day
      // session, matching the sensitivity of a medical inventory system.
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", csrfProtect, router);

// Optional static web serving for portable/desktop releases: when WEB_DIST
// points at a built web bundle, the API serves it on the same port (single-
// port offline operation) with an SPA fallback for client-side routing.
const webDistRoot = process.env.WEB_DIST;
if (webDistRoot) {
  app.use(express.static(webDistRoot, { index: "index.html" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(readFileSync(join(webDistRoot, "index.html")));
  });
}

// Start background alert worker (checks inventory every 2 h, runs once on boot)
startAlertWorker();

export default app;
