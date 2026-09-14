import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { auditLog } from "../middlewares/audit";
import { eq } from "drizzle-orm";
import { getPasswordPolicyError } from "../lib/password-policy";
import { getUsernamePolicyError } from "../lib/username-policy";

const router = Router();

// GET /api/users
router.get("/", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        fullName: usersTable.fullName,
        role: usersTable.role,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(usersTable.fullName);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/users
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { username, password, fullName, role } = req.body;
    if (!username || !password || !fullName || !role) {
      res.status(400).json({ error: "username, password, fullName, and role are required" });
      return;
    }
    const normalizedUsername = String(username).trim();
    const usernameError = getUsernamePolicyError(normalizedUsername);
    if (usernameError) {
      res.status(400).json({ error: usernameError });
      return;
    }
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }
    const validRoles = ["admin", "warehouse_manager", "viewer"];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(usersTable)
      .values({ username: normalizedUsername, passwordHash, fullName: String(fullName).trim(), role })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        fullName: usersTable.fullName,
        role: usersTable.role,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      });
    await auditLog({ req, action: "create", entityType: "user", entityId: user.id, details: { username: user.username, role: user.role } });
    res.status(201).json(user);
  } catch (err: unknown) {
    console.error(err);
    // PostgreSQL unique-constraint violation (Drizzle wraps it under err.cause)
    const pgCode = (err as { code?: string; cause?: { code?: string } })?.cause?.code
      ?? (err as { code?: string })?.code;
    if (pgCode === "23505" || (err instanceof Error && err.message.includes("unique"))) {
      res.status(409).json({ error: "اسم المستخدم موجود مسبقاً" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/users/:id
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
    const { fullName, role, password, isActive } = req.body;
    if (res.locals.user.id === id && isActive === false) {
      res.status(400).json({ error: "لا يمكن تعطيل حسابك الحالي" });
      return;
    }
    if (res.locals.user.id === id && role !== undefined && role !== res.locals.user.role) {
      res.status(400).json({ error: "لا يمكن تغيير دور حسابك الحالي" });
      return;
    }
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (fullName !== undefined) updates.fullName = String(fullName).trim();
    if (role !== undefined) {
      if (!["admin", "warehouse_manager", "viewer"].includes(role)) {
        res.status(400).json({ error: "Invalid role" }); return;
      }
      updates.role = role;
    }
    if (isActive !== undefined) updates.isActive = isActive;
    if (password) {
      const passwordError = getPasswordPolicyError(password);
      if (passwordError) {
        res.status(400).json({ error: passwordError }); return;
      }
      updates.passwordHash = await bcrypt.hash(password, 10);
    }

    const [user] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        fullName: usersTable.fullName,
        role: usersTable.role,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await auditLog({ req, action: "update", entityType: "user", entityId: user.id, details: { fullName: user.fullName, role: user.role, isActive: user.isActive } });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/users/:id (soft delete)
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
    const user = res.locals.user;
    if (user.id === id) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, id));
    await auditLog({ req, action: "delete", entityType: "user", entityId: id, details: {} });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
