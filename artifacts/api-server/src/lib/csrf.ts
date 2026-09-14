import { type RequestHandler } from "express";

/**
 * Same-origin allowlist — must stay in sync with the CORS configuration in
 * app.ts. Requests without an Origin/Referer (server-to-server scripts and
 * sync peers) are not browser CSRF targets and skip the token check.
 */
const allowedOriginPattern =
  /^(?:https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|(?:192\.168|10|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+(?::\d+)?)|https:\/\/(?:[a-z0-9-]+\.)+replit\.(?:dev|app))$/i;

/**
 * Synchronizer-token CSRF protection.
 *
 * Strategy:
 *  1. Requests without Origin/Referer (curl, node scripts, sync peers) pass
 *     through — CSRF requires a browser, and a browser always sends Origin.
 *  2. Browser requests must come from an allowed origin (same-origin or the
 *     Replit allowlist), enforced here as defense in depth on top of CORS.
 *  3. Session-backed browser requests must echo the per-session token that
 *     was issued at login/setup (and is returned by /api/auth/me) in the
 *     `X-CSRF-Token` header. The token lives only in the session store, so a
 *     cross-site form/request can never produce it.
 */
export const csrfProtect: RequestHandler = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) {
    next();
    return;
  }

  const source = String(origin || referer);
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    res.status(403).json({ error: "Invalid request origin" });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(403).json({ error: "Invalid request origin" });
    return;
  }
  if (!allowedOriginPattern.test(parsed.origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }

  // Session-less requests (sync peer mode authenticating with Basic auth)
  // carry no CSRF context and are not a browser CSRF vector.
  if (!req.session?.userId) {
    next();
    return;
  }

  const expected = req.session.csrfToken;
  const provided = req.headers["x-csrf-token"];
  if (!expected || typeof provided !== "string" || provided !== expected) {
    res.status(403).json({ error: "CSRF token mismatch" });
    return;
  }
  next();
};
