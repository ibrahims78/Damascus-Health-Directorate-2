import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, usersTable, systemSettingsTable } from "@workspace/db";
import { generateTotpSecret, totpUri, verifyTotp } from "../lib/totp";
import { requireAuth } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { eq } from "drizzle-orm";
import { getPasswordPolicyError } from "../lib/password-policy";
import {
  checkRateLimit,
  recordAuthAttempt,
  resetAuthAttempts,
} from "../lib/rate-limit";

const router = Router();

const BCRYPT_ROUNDS = 12;

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

// DB-backed rate limiter: counters survive restarts and are shared across
// instances pointing at the same database (see lib/rate-limit.ts).
async function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = String(req.ip ?? "unknown");
  const { allowed, retryAfterSeconds } = await checkRateLimit(key);
  if (!allowed) {
    res.set("Retry-After", String(retryAfterSeconds ?? 60));
    res.status(429).json({ error: "محاولات كثيرة. حاول مرة أخرى بعد قليل." });
    return;
  }
  res.locals.rateLimitKey = key;
  next();
}

function issueCsrfToken(req: Request) {
  const token = randomUUID();
  req.session.csrfToken = token;
  return token;
}

// GET /api/auth/setup-status
router.get("/setup-status", async (_req, res) => {
  try {
    const admin = await db.query.usersTable.findFirst({
      where: (u, { eq }) => eq(u.role, "admin"),
      columns: { id: true },
    });
    res.json({ needsSetup: !admin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/auth/setup
router.post("/setup", loginRateLimiter, async (req, res) => {
  try {
    // Only allowed if no admin exists
    const existing = await db.query.usersTable.findFirst({
      where: (u, { eq }) => eq(u.role, "admin"),
      columns: { id: true },
    });
    if (existing) {
      res.status(409).json({ error: "تم إعداد حساب المدير مسبقًا." });
      return;
    }
    const { username, password, fullName } = req.body as {
      username?: string;
      password?: string;
      fullName?: string;
    };
    if (!username || !password || !fullName) {
      res.status(400).json({ error: "اسم المستخدم وكلمة المرور والاسم الكامل مطلوبة." });
      return;
    }
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [user] = await db
      .insert(usersTable)
      .values({ username, passwordHash, fullName, role: "admin", mustChangePassword: false })
      .returning();

    // Mark setup as completed in system settings
    const existingSettings = await db.query.systemSettingsTable.findFirst();
    if (existingSettings) {
      await db
        .update(systemSettingsTable)
        .set({ setupCompleted: true, setupAt: new Date() })
        .where(eq(systemSettingsTable.id, existingSettings.id));
    } else {
      await db.insert(systemSettingsTable).values({ setupCompleted: true, setupAt: new Date() });
    }

    // Regenerate session to prevent session fixation
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    const csrfToken = issueCsrfToken(req);
    await saveSession(req);
    res.json({ id: user.id, username: user.username, fullName: user.fullName, role: user.role, mustChangePassword: false, csrfToken });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "اسم المستخدم مستخدم مسبقًا." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/auth/login
router.post("/login", loginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان." });
      return;
    }
    const user = await db.query.usersTable.findFirst({
      where: (u, { eq, and }) => and(eq(u.username, username), eq(u.isActive, true)),
    });
    if (!user) {
      await recordAuthAttempt(String(res.locals.rateLimitKey ?? req.ip ?? "unknown"));
      res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await recordAuthAttempt(String(res.locals.rateLimitKey ?? req.ip ?? "unknown"));
      res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
      return;
    }
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const code = String((req.body as { code?: unknown })?.code ?? "").trim();
      if (!code) {
        res.status(401).json({ error: "أدخل رمز المصادقة الثنائية.", twoFactorRequired: true });
        return;
      }
      if (!verifyTotp(user.twoFactorSecret, code)) {
        await recordAuthAttempt(String(res.locals.rateLimitKey ?? req.ip ?? "unknown"));
        res.status(401).json({ error: "رمز المصادقة الثنائية غير صحيح.", twoFactorRequired: true });
        return;
      }
    }

    await resetAuthAttempts(String(res.locals.rateLimitKey ?? req.ip ?? "unknown"));
    // Regenerate session to prevent session fixation
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.userId = user.id;
    const csrfToken = issueCsrfToken(req);
    await saveSession(req);
    await auditLog({ req, action: "login", entityType: "user", entityId: user.id, details: { username: user.username } });
    res.json({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      csrfToken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/auth/logout
// Logout is intentionally idempotent: an expired or already-destroyed
// session should still be treated as a successful logout.
router.post("/logout", async (req, res) => {
  try {
    const user = res.locals.user as { id?: number; username?: string } | undefined;
    if (user?.id) {
      await auditLog({ req, action: "logout", entityType: "user", entityId: user.id, details: { username: user.username } });
    }
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  } catch {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  const user = res.locals.user;
  res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    csrfToken: req.session.csrfToken ?? null,
  });
});


// POST /api/auth/2fa/setup - issue a secret for the signed-in account
router.post("/2fa/setup", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user;
    const secret = generateTotpSecret();
    await db.update(usersTable).set({ twoFactorSecret: secret }).where(eq(usersTable.id, user.id));
    res.json({ secret, otpauthUri: totpUri(secret, user.username), enabled: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// GET /api/auth/2fa/status
router.get("/2fa/status", requireAuth, async (_req, res) => {
  res.json({ enabled: Boolean(res.locals.user?.twoFactorEnabled) });
});

// POST /api/auth/2fa/enable { code }
router.post("/2fa/enable", requireAuth, async (req, res) => {
  try {
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, res.locals.user.id)).limit(1);
    if (!row?.twoFactorSecret) {
      res.status(409).json({ error: "ابدأ الإعداد أولًا للحصول على مفتاح.", code: "TWO_FACTOR_NOT_SET_UP" });
      return;
    }
    if (!verifyTotp(row.twoFactorSecret, String(req.body?.code ?? ""))) {
      res.status(400).json({ error: "الرمز غير صحيح. تأكد من ساعة الجهاز.", code: "TWO_FACTOR_INVALID_CODE" });
      return;
    }
    await db.update(usersTable).set({ twoFactorEnabled: true }).where(eq(usersTable.id, row.id));
    await auditLog({ req, action: "enable", entityType: "two_factor", entityId: row.id });
    res.json({ ok: true, enabled: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/auth/2fa/disable { code }
router.post("/2fa/disable", requireAuth, async (req, res) => {
  try {
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, res.locals.user.id)).limit(1);
    if (!row?.twoFactorEnabled || !row.twoFactorSecret) {
      res.status(409).json({ error: "المصادقة الثنائية غير مُفعّلة.", code: "TWO_FACTOR_NOT_ENABLED" });
      return;
    }
    if (!verifyTotp(row.twoFactorSecret, String(req.body?.code ?? ""))) {
      res.status(400).json({ error: "الرمز غير صحيح.", code: "TWO_FACTOR_INVALID_CODE" });
      return;
    }
    await db.update(usersTable).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(usersTable.id, row.id));
    await auditLog({ req, action: "disable", entityType: "two_factor", entityId: row.id });
    res.json({ ok: true, enabled: false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

// POST /api/auth/2fa/reset { userId } - admin lockout recovery
router.post("/2fa/reset", requireAuth, async (req, res) => {
  try {
    if (res.locals.user?.role !== "admin") {
      res.status(403).json({ error: "ليس لديك صلاحية للقيام بهذا الإجراء." });
      return;
    }
    const userId = Number(req.body?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "معرّف المستخدم غير صالح." });
      return;
    }
    await db.update(usersTable).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(usersTable.id, userId));
    await auditLog({ req, action: "reset", entityType: "two_factor", entityId: userId });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

export default router;
