import { Router } from "express";
import { auditLog } from "../middlewares/audit";
import { requireAuth, requireRole } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { runAlertWorker } from "../lib/alert-worker";
import {
  applyRestore,
  consumePreview,
  createDeltaBackup,
  createFullBackup,
  createPreview,
  createRestorePoint,
  decodePackage,
  enforceRetentionPolicy,
  getRestorePoint,
  getLatestBackup,
  getRetentionPolicy,
  listBackupCatalog,
  packageBufferToBase64,
  packageSummary,
  readCatalogPackage,
  rollbackRestorePoint,
  serverRestorePointPassword,
  storeBackupPackage,
  updateRetentionPolicy,
  verifyCatalogBackup,
  type RestoreMode,
} from "../lib/backup-service";

const router = Router();

function modeOf(value: unknown): RestoreMode {
  if (value === "full" || value === "merge") return value;
  throw new Error("يجب تحديد نمط الاستعادة full أو merge");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر معالجة حزمة النسخ";
}

// GET /api/backups — catalog metadata only; encrypted package contents stay hidden.
router.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  res.json({ backups: await listBackupCatalog(), policy: await getRetentionPolicy() });
});

// POST /api/backups — creates and catalogs a full or delta backup.
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length < 8) {
      res.status(400).json({ error: "كلمة مرور الحزمة مطلوبة (8 أحرف على الأقل)" });
      return;
    }
    const requestedType = req.body?.packageType === "delta-sync" ? "delta-sync" : "full-backup";
    const latest = await getLatestBackup();
    const baseVector =
      req.body?.baseVector && typeof req.body.baseVector === "object" ? req.body.baseVector : latest?.lastVector ?? {};
    const buffer =
      requestedType === "delta-sync" && latest
        ? await createDeltaBackup(password, baseVector as Record<string, number>)
        : await createFullBackup(password);
    const stored = await storeBackupPackage(buffer, password, {
      retentionClass:
        req.body?.retentionClass === "daily" ||
        req.body?.retentionClass === "weekly" ||
        req.body?.retentionClass === "monthly"
          ? req.body.retentionClass
          : "manual",
    });
    await auditLog({
      req,
      action: "backup_catalog_create",
      entityType: "backup",
      details: { backupId: stored.id, packageType: stored.packageType, bytes: stored.byteSize },
    });
    res.status(201).json({
      id: stored.id,
      packageHash: stored.packageHash,
      packageType: stored.packageType,
      recordCount: stored.recordCount,
      changeCount: stored.changeCount,
      byteSize: stored.byteSize,
      baseVector: stored.baseVector,
      lastVector: stored.lastVector,
      retentionClass: stored.retentionClass,
      summary: stored.summary,
    });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/policy", requireAuth, requireRole("admin"), async (_req, res) => {
  res.json(await getRetentionPolicy());
});

router.put("/policy", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    res.json(await updateRetentionPolicy(req.body ?? {}));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/retention/enforce", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    res.json(await enforceRetentionPolicy());
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// POST /api/backups/export — creates the canonical encrypted .dme-sync package.
router.post("/export", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length < 8) {
      res.status(400).json({ error: "كلمة مرور الحزمة مطلوبة (8 أحرف على الأقل)" });
      return;
    }
    const buffer = await createFullBackup(password);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="damascus-${date}.dme-sync"`);
    res.send(buffer);
    await auditLog({ req, action: "backup_package_export", entityType: "backup", details: { bytes: buffer.length } });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/:backupId/package", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const buffer = await readCatalogPackage(String(req.params.backupId));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${String(req.params.backupId)}.dme-sync"`);
    res.send(buffer);
  } catch (error) {
    res.status(404).json({ error: errorMessage(error) });
  }
});

router.post("/:backupId/verify", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    res.json(await verifyCatalogBackup(String(req.params.backupId), password));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/inspect", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const pkg = decodePackage(String(req.body?.packageBase64 ?? ""), String(req.body?.password ?? ""));
    res.json(packageSummary(pkg));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/dry-run", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const mode = modeOf(req.body?.mode);
    const pkg = decodePackage(String(req.body?.packageBase64 ?? ""), String(req.body?.password ?? ""));
    const preview = await createPreview(pkg, mode);
    res.json(preview);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/restore", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "يجب تأكيد الاستعادة بعد المعاينة بإرسال confirm=true" });
      return;
    }
    const mode = modeOf(req.body?.mode);
    const pkg = decodePackage(String(req.body?.packageBase64 ?? ""), String(req.body?.password ?? ""));
    await consumePreview(String(req.body?.previewToken ?? ""), pkg.packageHash, mode);
    const beforeRestore = await createFullBackup(serverRestorePointPassword());
    const userId = Number(req.session.userId);
    const report = await applyRestore(
      pkg,
      mode,
      Number.isInteger(userId) ? userId : null,
    );
    // Restores can replace the inventory data after the periodic worker has run.
    // Recompute immediately so the notifications bell reflects the restored state.
    await runAlertWorker();
    const restorePointId = await createRestorePoint(Number.isInteger(userId) ? userId : null, beforeRestore, report);
    await auditLog({
      req,
      action: "backup_package_restore",
      entityType: "backup",
      details: { restorePointId, mode, packageHash: report.packageHash, counts: report.counts },
    });
    res.json({ ...report, restorePointId });
  } catch (error) {
    logger.error({ err: error }, "Backup restore failed");
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/:restorePointId/report", requireAuth, requireRole("admin"), async (req, res) => {
  const restorePointId = String(req.params.restorePointId);
  const point = await getRestorePoint(restorePointId);
  if (!point) {
    res.status(404).json({ error: "نقطة الاستعادة غير موجودة" });
    return;
  }
  res.json({
    id: point.id,
    packageHash: point.packageHash,
    status: point.status,
    createdBy: point.createdBy,
    createdAt: point.createdAt,
    rolledBackAt: point.rolledBackAt,
    summary: point.summary,
  });
});

router.post("/:restorePointId/rollback", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "يجب إرسال confirm=true لتأكيد التراجع" });
      return;
    }
    const restorePointId = String(req.params.restorePointId);
    const report = await rollbackRestorePoint(restorePointId);
    // A rollback also changes inventory conditions and must refresh active alerts.
    await runAlertWorker();
    await auditLog({
      req,
      action: "backup_restore_rollback",
      entityType: "backup",
      details: { restorePointId, counts: report.counts },
    });
    res.json({ ...report, restorePointId });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

export default router;