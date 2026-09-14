import { Router } from "express";
import { db } from "@workspace/db";
import {
  categoriesTable,
  itemsTable,
  equipmentTable,
  transactionsTable,
  recipientsTable,
  exitReasonsTable,
  usersTable,
  systemSettingsTable,
  inventoryBatchesTable,
  transactionBatchAllocationsTable,
  personalCustodiesTable,
  custodyReturnsTable,
  damageRecordsTable,
  centralReturnsTable,
  auditLogTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { sql } from "drizzle-orm";

const router = Router();

// GET /api/backup/export — download full data backup as JSON (admin only)
router.get("/export", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [
      categories,
      items,
      equipment,
      transactions,
      recipients,
      exitReasons,
      users,
      settings,
      batches,
      batchAllocations,
      custodies,
      custodyReturns,
      damageRecords,
      centralReturns,
      auditLogs,
    ] = await Promise.all([
      db.select().from(categoriesTable),
      db.select().from(itemsTable),
      db.select().from(equipmentTable),
      db.select().from(transactionsTable),
      db.select().from(recipientsTable),
      db.select().from(exitReasonsTable),
      // Exclude password hashes from backup for security — restore requires re-hashing
      db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          fullName: usersTable.fullName,
          role: usersTable.role,
          isActive: usersTable.isActive,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable),
      db.select().from(systemSettingsTable),
      db.select().from(inventoryBatchesTable),
      db.select().from(transactionBatchAllocationsTable),
      db.select().from(personalCustodiesTable),
      db.select().from(custodyReturnsTable),
      db.select().from(damageRecordsTable),
      db.select().from(centralReturnsTable),
      db.select().from(auditLogTable),
    ]);

    const backup = {
      version: "2.0",
      system: "مستودعات مديرية صحة دمشق",
      exportedAt: new Date().toISOString(),
      counts: {
        categories: categories.length,
        items: items.length,
        equipment: equipment.length,
        transactions: transactions.length,
        recipients: recipients.length,
        exitReasons: exitReasons.length,
        users: users.length,
        batches: batches.length,
        batchAllocations: batchAllocations.length,
        custodies: custodies.length,
        custodyReturns: custodyReturns.length,
        damageRecords: damageRecords.length,
        centralReturns: centralReturns.length,
        auditLogs: auditLogs.length,
      },
      data: {
        categories,
        items,
        equipment,
        transactions,
        recipients,
        exitReasons,
        users,
        settings,
        batches,
        batchAllocations,
        custodies,
        custodyReturns,
        damageRecords,
        centralReturns,
        auditLogs,
      },
    };

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `damascus-health-directorate-warehouse-backup-${dateStr}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.json(backup);
    await auditLog({
      req,
      action: "backup_export",
      entityType: "backup",
      details: { version: backup.version, counts: backup.counts },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/backup/restore — transactional merge restore. Existing IDs win;
// users are intentionally not restored because exports omit password hashes.
router.post("/restore", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const payload = req.body as {
      version?: string;
      data?: Record<string, unknown>;
      confirm?: boolean;
    };
    if (!payload?.confirm) {
      res.status(400).json({ error: "يجب إرسال confirm=true لتأكيد الاستعادة" });
      return;
    }
    if (!payload.data || !["1.0", "2.0"].includes(String(payload.version))) {
      res.status(400).json({ error: "ملف النسخة الاحتياطية غير صالح أو غير مدعوم" });
      return;
    }

    const data = payload.data;
    const arrays = (name: string) => (Array.isArray(data[name]) ? data[name] : []);
    const restored = await db.transaction(async (tx) => {
      const counts: Record<string, number> = {};
      const restoreTable = async (name: string, table: unknown) => {
        const rows = arrays(name);
        if (rows.length === 0) return;
        await tx.insert(table as never).values(rows as never).onConflictDoNothing();
        counts[name] = rows.length;
      };

      // Parent tables first, then immutable movement/detail tables.
      await restoreTable("categories", categoriesTable);
      await restoreTable("items", itemsTable);
      await restoreTable("equipment", equipmentTable);
      await restoreTable("recipients", recipientsTable);
      await restoreTable("exitReasons", exitReasonsTable);
      await restoreTable("settings", systemSettingsTable);
      await restoreTable("transactions", transactionsTable);
      await restoreTable("batches", inventoryBatchesTable);
      await restoreTable("batchAllocations", transactionBatchAllocationsTable);
      await restoreTable("custodies", personalCustodiesTable);
      await restoreTable("custodyReturns", custodyReturnsTable);
      await restoreTable("damageRecords", damageRecordsTable);
      await restoreTable("centralReturns", centralReturnsTable);
      // Audit rows are optional and can be restored after all entities exist.
      await restoreTable("auditLogs", auditLogTable);

      const sequenceTables = [
        ["categories", "categories"],
        ["items", "items"],
        ["equipment", "equipment"],
        ["recipients", "recipients"],
        ["exit_reasons", "exit_reasons"],
        ["transactions", "transactions"],
        ["inventory_batches", "inventory_batches"],
        ["transaction_batch_allocations", "transaction_batch_allocations"],
        ["personal_custodies", "personal_custodies"],
        ["custody_returns", "custody_returns"],
        ["damage_records", "damage_records"],
        ["central_returns", "central_returns"],
        ["audit_log", "audit_log"],
      ] as const;
      for (const [tableName, sequenceTable] of sequenceTables) {
        await tx.execute(sql.raw(
          `SELECT setval(pg_get_serial_sequence('${sequenceTable}', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 1), true)`,
        ));
      }
      return counts;
    });

    const result = {
      restored,
      skippedUsers: arrays("users").length,
      warning: "لم تتم استعادة المستخدمين لأن النسخة الاحتياطية لا تحتوي كلمات المرور؛ بقيت حسابات البيئة الحالية كما هي.",
    };
    await auditLog({
      req,
      action: "backup_restore",
      entityType: "backup",
      details: result,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "تعذر استعادة النسخة؛ تم التراجع عن العملية بالكامل" });
  }
});

// GET /api/backup/info — get backup metadata (counts of all tables)
router.get("/info", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const { sql } = await import("drizzle-orm");
    const [
      catCount,
      itemCount,
      equipCount,
      txCount,
      recCount,
      userCount,
      batchCount,
      custodyCount,
      auditCount,
    ] = await Promise.all([
      db.select({ c: sql<number>`count(*)` }).from(categoriesTable),
      db.select({ c: sql<number>`count(*)` }).from(itemsTable),
      db.select({ c: sql<number>`count(*)` }).from(equipmentTable),
      db.select({ c: sql<number>`count(*)` }).from(transactionsTable),
      db.select({ c: sql<number>`count(*)` }).from(recipientsTable),
      db.select({ c: sql<number>`count(*)` }).from(usersTable),
      db.select({ c: sql<number>`count(*)` }).from(inventoryBatchesTable),
      db.select({ c: sql<number>`count(*)` }).from(personalCustodiesTable),
      db.select({ c: sql<number>`count(*)` }).from(auditLogTable),
    ]);

    res.json({
      categories: Number(catCount[0]?.c ?? 0),
      items: Number(itemCount[0]?.c ?? 0),
      equipment: Number(equipCount[0]?.c ?? 0),
      transactions: Number(txCount[0]?.c ?? 0),
      recipients: Number(recCount[0]?.c ?? 0),
      users: Number(userCount[0]?.c ?? 0),
      batches: Number(batchCount[0]?.c ?? 0),
      custodies: Number(custodyCount[0]?.c ?? 0),
      auditLogs: Number(auditCount[0]?.c ?? 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
