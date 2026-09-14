import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, systemSettingsTable, usersTable, auditLogTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { eq, desc } from "drizzle-orm";
import { runAlertWorker } from "../lib/alert-worker";
import { getPasswordPolicyError } from "../lib/password-policy";

const router = Router();

// The same canonical defaults are exposed by the settings API and used by
// the admin editor. This keeps the item form's unit dropdown populated even
// before an administrator saves a customized list.
const DEFAULT_UNITS = [
  "قطعة",
  "علبة",
  "لتر",
  "مل",
  "كيس",
  "زجاجة",
  "برميل",
  "رول",
  "كرتون",
  "طرد",
  "حبة",
  "زوج",
  "مجموعة",
  "جرام",
  "كيلوغرام",
];

const DEFAULT_TECHNICAL_CONDITIONS = [
  { key: "good", label: "جيد" },
  { key: "needs_inspection", label: "يحتاج فحص" },
  { key: "maintenance", label: "تحت الصيانة" },
  { key: "broken", label: "معطل" },
  { key: "consumed", label: "مستهلك / متلف" },
];

const DEFAULT_RETURN_CONDITIONS = [
  { key: "good", label: "جيد", behavior: "good" },
  { key: "damaged", label: "تالف", behavior: "damaged" },
  { key: "needs_maintenance", label: "يحتاج صيانة", behavior: "needs_maintenance" },
  { key: "missing", label: "مفقود", behavior: "missing" },
];

async function getOrCreateSettings() {
  let settings = await db.query.systemSettingsTable.findFirst();
  if (!settings) {
    const [created] = await db.insert(systemSettingsTable).values({}).returning();
    settings = created;
  }
  return settings;
}

// GET /api/settings
router.get("/", requireAuth, async (_req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({
      ...settings,
      unitsList: settings.unitsList ?? JSON.stringify(DEFAULT_UNITS),
      technicalConditions: settings.technicalConditions ?? JSON.stringify(DEFAULT_TECHNICAL_CONDITIONS),
      returnConditions: settings.returnConditions ?? JSON.stringify(DEFAULT_RETURN_CONDITIONS),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function validateSystemSettingsInput(input: {
  orgName?: unknown;
  orgSubtitle?: unknown;
  expiryAlertDays?: unknown;
}) {
  const normalized: {
    orgName?: string;
    orgSubtitle?: string | null;
    expiryAlertDays?: number;
  } = {};

  if (input.orgName !== undefined) {
    if (typeof input.orgName !== "string") {
      return { error: "اسم المستودع يجب أن يكون نصاً" };
    }
    const orgName = input.orgName.trim();
    if (orgName.length < 2) {
      return { error: "اسم المستودع مطلوب ولا يمكن أن يكون فارغاً" };
    }
    if (orgName.length > 200) {
      return { error: "اسم المستودع طويل جداً" };
    }
    normalized.orgName = orgName;
  }

  if (input.orgSubtitle !== undefined) {
    if (input.orgSubtitle === null) {
      normalized.orgSubtitle = null;
    } else if (typeof input.orgSubtitle === "string") {
      const orgSubtitle = input.orgSubtitle.trim();
      if (orgSubtitle.length > 200) {
        return { error: "العنوان الفرعي طويل جداً" };
      }
      normalized.orgSubtitle = orgSubtitle || null;
    } else {
      return { error: "العنوان الفرعي يجب أن يكون نصاً" };
    }
  }

  if (input.expiryAlertDays !== undefined) {
    if (
      typeof input.expiryAlertDays !== "number" ||
      !Number.isInteger(input.expiryAlertDays) ||
      input.expiryAlertDays < 1 ||
      input.expiryAlertDays > 365
    ) {
      return { error: "أيام التنبيه يجب أن تكون رقماً صحيحاً بين 1 و365" };
    }
    normalized.expiryAlertDays = input.expiryAlertDays;
  }

  return { normalized };
}

// PUT /api/settings
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { orgName, orgSubtitle, expiryAlertDays, unitsList, technicalConditions, returnConditions } = req.body;
    const validated = validateSystemSettingsInput({ orgName, orgSubtitle, expiryAlertDays });
    if ("error" in validated) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const settings = await getOrCreateSettings();

    let normalizedUnitsList: string | undefined;
    let normalizedTechnicalConditions: string | undefined;
    let normalizedReturnConditions: string | undefined;

    // Validate and normalize unitsList if provided
    if (unitsList !== undefined) {
      if (typeof unitsList !== "string") {
        res.status(400).json({ error: "unitsList must be a JSON string" });
        return;
      }
      try {
        const parsed = JSON.parse(unitsList);
        if (
          !Array.isArray(parsed) ||
          parsed.length > 100 ||
          parsed.some((unit) => typeof unit !== "string" || unit.trim().length === 0 || unit.trim().length > 100)
        ) {
          throw new Error();
        }
        const normalized = parsed.map((unit: string) => unit.trim());
        const unique = new Set(normalized.map((unit) => unit.toLocaleLowerCase()));
        if (unique.size !== normalized.length) throw new Error();
        normalizedUnitsList = JSON.stringify(normalized);
      } catch {
        res.status(400).json({ error: "يجب أن تكون وحدات القياس قائمة نصوص غير فارغة وفريدة" });
        return;
      }
    }

    if (technicalConditions !== undefined) {
      if (typeof technicalConditions !== "string") {
        res.status(400).json({ error: "technicalConditions must be a JSON string" });
        return;
      }
      try {
        const parsed = JSON.parse(technicalConditions);
        if (
          !Array.isArray(parsed) ||
          parsed.length === 0 ||
          parsed.length > 100 ||
          parsed.some(
            (condition) =>
              !condition ||
              typeof condition !== "object" ||
              typeof condition.key !== "string" ||
              !/^[a-z0-9_:-]+$/.test(condition.key.trim()) ||
              typeof condition.label !== "string" ||
              condition.label.trim().length === 0 ||
              condition.label.trim().length > 100,
          )
        ) {
          throw new Error();
        }
        const normalized = parsed.map((condition: { key: string; label: string }) => ({
          key: condition.key.trim(),
          label: condition.label.trim(),
        }));
        const keys = new Set(normalized.map((condition) => condition.key));
        const labels = new Set(normalized.map((condition) => condition.label.toLocaleLowerCase()));
        if (keys.size !== normalized.length || labels.size !== normalized.length) throw new Error();
        normalizedTechnicalConditions = JSON.stringify(normalized);
      } catch {
        res.status(400).json({ error: "يجب أن تكون الحالات الفنية قائمة فريدة من عناصر ذات مفتاح واسم صحيحين" });
        return;
      }
    }

    if (returnConditions !== undefined) {
      if (typeof returnConditions !== "string") {
        res.status(400).json({ error: "returnConditions must be a JSON string" });
        return;
      }
      try {
        const parsed = JSON.parse(returnConditions);
        const behaviors = new Set(["good", "damaged", "needs_maintenance", "missing"]);
        if (
          !Array.isArray(parsed) ||
          parsed.length === 0 ||
          parsed.length > 100 ||
          parsed.some(
            (condition) =>
              !condition ||
              typeof condition !== "object" ||
              typeof condition.key !== "string" ||
              !/^[a-z0-9_:-]+$/.test(condition.key.trim()) ||
              typeof condition.label !== "string" ||
              condition.label.trim().length === 0 ||
              condition.label.trim().length > 100 ||
              !behaviors.has(condition.behavior),
          )
        ) {
          throw new Error();
        }
        const normalized = parsed.map((condition: { key: string; label: string; behavior: string }) => ({
          key: condition.key.trim(),
          label: condition.label.trim(),
          behavior: condition.behavior,
        }));
        const keys = new Set(normalized.map((condition) => condition.key));
        const labels = new Set(normalized.map((condition) => condition.label.toLocaleLowerCase()));
        if (keys.size !== normalized.length || labels.size !== normalized.length) throw new Error();
        normalizedReturnConditions = JSON.stringify(normalized);
      } catch {
        res.status(400).json({ error: "يجب أن تكون حالات الإعادة قائمة فريدة بعناوين وتأثيرات صحيحة" });
        return;
      }
    }

    const [updated] = await db
      .update(systemSettingsTable)
      .set({
        ...(validated.normalized.orgName !== undefined && { orgName: validated.normalized.orgName }),
        ...(validated.normalized.orgSubtitle !== undefined && { orgSubtitle: validated.normalized.orgSubtitle }),
        ...(validated.normalized.expiryAlertDays !== undefined && {
          expiryAlertDays: validated.normalized.expiryAlertDays,
        }),
        ...(normalizedUnitsList !== undefined && { unitsList: normalizedUnitsList }),
        ...(normalizedTechnicalConditions !== undefined && { technicalConditions: normalizedTechnicalConditions }),
        ...(normalizedReturnConditions !== undefined && { returnConditions: normalizedReturnConditions }),
        updatedAt: new Date(),
      })
      .where(eq(systemSettingsTable.id, settings.id))
      .returning();

    // Recompute alerts before responding so a changed expiry window is visible
    // immediately through the API and SSE, rather than waiting for the 2-hour job.
    if (validated.normalized.expiryAlertDays !== undefined) {
      await runAlertWorker();
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/settings/change-password — authenticated user changes their own password
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user;
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword are required" });
      return;
    }
    const passwordError = getPasswordPolicyError(newPassword);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }
    const fullUser = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, user.id),
    });
    if (!fullUser) { res.status(404).json({ error: "User not found" }); return; }
    const valid = await bcrypt.compare(currentPassword, fullUser.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
      return;
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(usersTable)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(usersTable.id, user.id));
    await auditLog({ req, action: "update", entityType: "user", entityId: user.id, details: { action: "password_changed" } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/settings/profile — authenticated user updates their own fullName
router.patch("/profile", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user;
    const { fullName } = req.body as { fullName?: string };
    if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
      res.status(400).json({ error: "الاسم الكامل مطلوب (حرفان على الأقل)" });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ fullName: fullName.trim() })
      .where(eq(usersTable.id, user.id))
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        fullName: usersTable.fullName,
        role: usersTable.role,
      });
    await auditLog({
      req,
      action: "update",
      entityType: "user",
      entityId: user.id,
      details: { fullName: updated.fullName },
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/settings/my-activity — current user's recent 20 audit log entries
router.get("/my-activity", requireAuth, async (req, res) => {
  try {
    const user = res.locals.user;
    const logs = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.userId, user.id))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(20);
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
