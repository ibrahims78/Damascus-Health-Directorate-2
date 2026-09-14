import { type RequestHandler } from "express";
import { db } from "@workspace/db";

export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const user = await db.query.usersTable.findFirst({
      where: (u, { eq, and }) => and(eq(u.id, userId), eq(u.isActive, true)),
      columns: { passwordHash: false },
    });
    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.locals.user = user;
    next();
  } catch {
    res.status(503).json({ error: "Service unavailable" });
  }
};

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, res, next) => {
    const user = res.locals.user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
