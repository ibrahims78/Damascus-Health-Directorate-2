import {
  db,
  equipmentTable,
  personalCustodiesTable,
  recipientsTable,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, gte, ilike, lte, sql } from "drizzle-orm";

export type EquipmentHistoryFilters = {
  type?: string;
  from?: string;
  to?: string;
  document?: string;
};

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export async function getEquipmentHistory(
  equipmentId: number,
  filters: EquipmentHistoryFilters = {},
) {
  const [equipmentRows, custodyRows, movementRows] = await Promise.all([
    db
      .select({
        id: equipmentTable.id,
        name: equipmentTable.name,
        equipmentType: equipmentTable.equipmentType,
        model: equipmentTable.model,
        serialNumber: equipmentTable.serialNumber,
        condition: equipmentTable.condition,
        manufactureYear: equipmentTable.manufactureYear,
        originCountry: equipmentTable.originCountry,
        currentHolder: equipmentTable.currentHolder,
        quantity: equipmentTable.quantity,
        minQuantity: equipmentTable.minQuantity,
        notes: equipmentTable.notes,
        maintenanceSentAt: equipmentTable.maintenanceSentAt,
        maintenanceReturnedAt: equipmentTable.maintenanceReturnedAt,
        maintenanceNotes: equipmentTable.maintenanceNotes,
        createdAt: equipmentTable.createdAt,
        updatedAt: equipmentTable.updatedAt,
      })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, equipmentId)),
    db
      .select({
        id: personalCustodiesTable.id,
        equipmentId: personalCustodiesTable.equipmentId,
        holderName: personalCustodiesTable.holderNameSnap,
        recipientName: recipientsTable.name,
        quantity: personalCustodiesTable.quantity,
        returnedQuantity: personalCustodiesTable.returnedQuantity,
        outstandingQuantity: sql<number>`${personalCustodiesTable.quantity} - ${personalCustodiesTable.returnedQuantity}`,
        deliveryNoteNumber: personalCustodiesTable.deliveryNoteNumber,
        deliveryDate: personalCustodiesTable.deliveryDate,
        location: personalCustodiesTable.location,
        status: personalCustodiesTable.status,
        createdAt: personalCustodiesTable.createdAt,
        updatedAt: personalCustodiesTable.updatedAt,
      })
      .from(personalCustodiesTable)
      .leftJoin(recipientsTable, eq(personalCustodiesTable.recipientId, recipientsTable.id))
      .where(eq(personalCustodiesTable.equipmentId, equipmentId))
      .orderBy(asc(personalCustodiesTable.deliveryDate), asc(personalCustodiesTable.id)),
    (() => {
      const conditions = [eq(transactionsTable.equipmentId, equipmentId)];
      if (filters.type) {
        conditions.push(
          eq(
            transactionsTable.type,
            filters.type as
              | "in"
              | "out"
              | "init"
              | "adjust"
              | "custody_out"
              | "custody_return"
              | "damage"
              | "central_return",
          ),
        );
      }
      if (filters.from) conditions.push(gte(transactionsTable.documentDate, filters.from));
      if (filters.to) conditions.push(lte(transactionsTable.documentDate, filters.to));
      if (filters.document) {
        conditions.push(ilike(transactionsTable.documentNumber, `%${filters.document}%`));
      }

      return db
        .select({
          id: transactionsTable.id,
          type: transactionsTable.type,
          quantity: transactionsTable.quantity,
          partyName: transactionsTable.recipientNameSnap,
          holderName: transactionsTable.custodyHolderNameSnap,
          documentNumber: transactionsTable.documentNumber,
          documentDate: transactionsTable.documentDate,
          custodyNoteNumber: transactionsTable.custodyNoteNumber,
          custodyDate: transactionsTable.custodyDate,
          custodyLocation: transactionsTable.custodyLocation,
          reason: transactionsTable.reason,
          notes: transactionsTable.notes,
          details: transactionsTable.details,
          createdAt: transactionsTable.createdAt,
          operatorName: usersTable.fullName,
        })
        .from(transactionsTable)
        .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
        .where(and(...conditions))
        .orderBy(
          sql`${transactionsTable.documentDate} ASC NULLS LAST`,
          asc(transactionsTable.createdAt),
          asc(transactionsTable.id),
        );
    })(),
  ]);

  const equipment = equipmentRows[0];
  if (!equipment) return null;

  const custodyQuantity = custodyRows.reduce(
    (sum, custody) => sum + Number(custody.outstandingQuantity ?? 0),
    0,
  );

  return {
    equipment: {
      ...equipment,
      quantity: Number(equipment.quantity),
      minQuantity: Number(equipment.minQuantity),
      custodyQuantity,
      availableQuantity: Math.max(0, Number(equipment.quantity) - custodyQuantity),
      createdAt: asDate(equipment.createdAt),
      updatedAt: asDate(equipment.updatedAt),
    },
    custodies: custodyRows.map((custody) => ({
      ...custody,
      quantity: Number(custody.quantity),
      returnedQuantity: Number(custody.returnedQuantity),
      outstandingQuantity: Number(custody.outstandingQuantity),
      createdAt: asDate(custody.createdAt),
      updatedAt: asDate(custody.updatedAt),
    })),
    movements: movementRows.map((movement) => ({
      ...movement,
      quantity: movement.quantity === null ? null : Number(movement.quantity),
      documentDate: movement.documentDate ?? null,
      createdAt: asDate(movement.createdAt),
    })),
    total: movementRows.length,
  };
}