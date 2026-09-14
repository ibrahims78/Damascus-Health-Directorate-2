import { Router } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  equipmentTable,
  personalCustodiesTable,
  recipientsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getCustodyHistory } from "../lib/custody-history-service";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const conditions = [];

    if (status) conditions.push(eq(personalCustodiesTable.status, status as never));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(equipmentTable.name, pattern),
          ilike(equipmentTable.serialNumber, pattern),
          ilike(personalCustodiesTable.holderNameSnap, pattern),
          ilike(personalCustodiesTable.deliveryNoteNumber, pattern),
        )!,
      );
    }

    const rows = await db
      .select({
        id: personalCustodiesTable.id,
        equipmentId: personalCustodiesTable.equipmentId,
        equipmentName: equipmentTable.name,
        serialNumber: equipmentTable.serialNumber,
        quantity: personalCustodiesTable.quantity,
        returnedQuantity: personalCustodiesTable.returnedQuantity,
        outstandingQuantity: sql<number>`${personalCustodiesTable.quantity} - ${personalCustodiesTable.returnedQuantity}`,
        recipientId: personalCustodiesTable.recipientId,
        holderName: personalCustodiesTable.holderNameSnap,
        deliveryNoteNumber: personalCustodiesTable.deliveryNoteNumber,
        deliveryDate: personalCustodiesTable.deliveryDate,
        location: personalCustodiesTable.location,
        status: personalCustodiesTable.status,
      })
      .from(personalCustodiesTable)
      .innerJoin(equipmentTable, eq(personalCustodiesTable.equipmentId, equipmentTable.id))
      .leftJoin(recipientsTable, eq(personalCustodiesTable.recipientId, recipientsTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(sql`${personalCustodiesTable.createdAt} DESC`);

    res.json(rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      returnedQuantity: Number(row.returnedQuantity),
      outstandingQuantity: Number(row.outstandingQuantity),
    })));
  } catch (error) {
    console.error("[custodies]", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/custodies/:id — independent custody card and lifecycle history.
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid custody id" });
      return;
    }
    const data = await getCustodyHistory(id);
    if (!data) {
      res.status(404).json({ error: "Custody not found" });
      return;
    }
    res.json(data);
  } catch (error) {
    console.error("[custody-history]", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;