import { Router } from "express";
import { db, auditLogTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { and, desc, gte, lte, eq, sql } from "drizzle-orm";

const router = Router();

function parseDateFilter(value: string | undefined, label: string, endOfDay = false): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be an ISO date`);
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid date`);
  }
  return date;
}

// GET /api/audit — admin only, paginated audit log with optional filters
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const {
      from,
      to,
      userId,
      action,
      entityType,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    let fromDate: Date | null;
    let toDate: Date | null;
    try {
      fromDate = parseDateFilter(from, "from");
      toDate = parseDateFilter(to, "to", true);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid date filter" });
      return;
    }
    if (fromDate && toDate && fromDate > toDate) {
      res.status(400).json({ error: "from must be before to" });
      return;
    }
    if (fromDate) conditions.push(gte(auditLogTable.createdAt, fromDate));
    if (toDate) conditions.push(lte(auditLogTable.createdAt, toDate));
    if (userId) {
      const parsedUserId = parseInt(userId);
      if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
        res.status(400).json({ error: "userId must be a positive integer" });
        return;
      }
      conditions.push(eq(auditLogTable.userId, parsedUserId));
    }
    if (action) conditions.push(eq(auditLogTable.action, action));
    if (entityType) conditions.push(eq(auditLogTable.entityType, entityType));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogTable)
        .where(where)
        .orderBy(desc(auditLogTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogTable)
        .where(where),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    res.json({
      data: logs,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
