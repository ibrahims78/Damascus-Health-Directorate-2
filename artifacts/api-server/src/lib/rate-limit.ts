import { db, authRateLimitTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

/**
 * DB-backed auth rate limiting.
 *
 * Replaces the previous in-memory Map: counters survive restarts, are shared
 * by every instance pointing at the same database, and can be administered
 * with plain SQL. `reset_at` defines a sliding 15-minute window; when it
 * passes, the next attempt starts a fresh window.
 */
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export async function checkRateLimit(key: string): Promise<{
  allowed: boolean;
  retryAfterSeconds?: number;
}> {
  // Opportunistic cleanup of expired rows for this key (cheap, keeps the
  // table from growing unboundedly on high-churn IPs).
  await db
    .delete(authRateLimitTable)
    .where(lt(authRateLimitTable.resetAt, new Date()))
    .catch(() => undefined);

  const now = new Date();
  const [row] = await db
    .select()
    .from(authRateLimitTable)
    .where(eq(authRateLimitTable.key, key))
    .limit(1);

  if (!row || row.resetAt <= now) return { allowed: true };
  if (row.attempts >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }
  return { allowed: true };
}

export async function recordAuthAttempt(key: string): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + RATE_WINDOW_MS);
  const [row] = await db
    .select()
    .from(authRateLimitTable)
    .where(eq(authRateLimitTable.key, key))
    .limit(1);

  if (!row || row.resetAt <= now) {
    await db
      .insert(authRateLimitTable)
      .values({ key, attempts: 1, resetAt })
      .onConflictDoUpdate({
        target: authRateLimitTable.key,
        set: { attempts: 1, resetAt, updatedAt: now },
      });
  } else {
    await db
      .update(authRateLimitTable)
      .set({ attempts: row.attempts + 1, updatedAt: now })
      .where(eq(authRateLimitTable.key, key));
  }
}

export async function resetAuthAttempts(key: string): Promise<void> {
  await db.delete(authRateLimitTable).where(eq(authRateLimitTable.key, key));
}
