import { logger } from "./logger";
import {
  createDeltaBackup,
  createFullBackup,
  enforceRetentionPolicy,
  getLatestBackup,
  storeBackupPackage,
} from "./backup-service";

let schedulerTimer: NodeJS.Timeout | undefined;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function runScheduledBackup(password: string) {
  const latest = await getLatestBackup();
  const packageBuffer =
    latest?.packageType === "full-backup"
      ? await createDeltaBackup(password, (latest.lastVector ?? {}) as Record<string, number>)
      : latest
        ? await createDeltaBackup(password, (latest.lastVector ?? {}) as Record<string, number>)
        : await createFullBackup(password);
  const stored = await storeBackupPackage(packageBuffer, password, { retentionClass: "daily" });
  const retention = await enforceRetentionPolicy();
  logger.info(
    {
      backupId: stored.id,
      packageType: stored.packageType,
      bytes: stored.byteSize,
      deleted: retention.deleted.length,
    },
    "Scheduled backup completed",
  );
  return { stored, retention };
}

export function startBackupScheduler() {
  if (process.env.BACKUP_SCHEDULER_ENABLED !== "1") {
    logger.info("Backup scheduler is disabled; set BACKUP_SCHEDULER_ENABLED=1 to enable it");
    return;
  }
  const password = process.env.BACKUP_SCHEDULER_PASSWORD;
  if (!password || password.length < 8) {
    logger.warn("Backup scheduler is disabled because BACKUP_SCHEDULER_PASSWORD is missing or too short");
    return;
  }

  const intervalMs = positiveInteger(process.env.BACKUP_SCHEDULE_INTERVAL_MS, 24 * 60 * 60 * 1000);
  schedulerTimer = setInterval(() => {
    void runScheduledBackup(password).catch((error) => {
      logger.error({ err: error }, "Scheduled backup failed; previous backups were retained");
    });
  }, intervalMs);
  schedulerTimer.unref?.();
  logger.info({ intervalMs }, "Backup scheduler started");
}

export function stopBackupScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = undefined;
}