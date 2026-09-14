import {
  custodyReturnsTable,
  db,
  equipmentTable,
  personalCustodiesTable,
  recipientsTable,
  transactionsTable,
  usersTable,
} from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export async function getCustodyHistory(custodyId: number) {
  const [custodyRows, returnRows] = await Promise.all([
    db
      .select({
        id: personalCustodiesTable.id,
        equipmentId: personalCustodiesTable.equipmentId,
        equipmentName: equipmentTable.name,
        equipmentType: equipmentTable.equipmentType,
        model: equipmentTable.model,
        serialNumber: equipmentTable.serialNumber,
        holderName: personalCustodiesTable.holderNameSnap,
        recipientName: recipientsTable.name,
        quantity: personalCustodiesTable.quantity,
        returnedQuantity: personalCustodiesTable.returnedQuantity,
        outstandingQuantity: sql<number>`${personalCustodiesTable.quantity} - ${personalCustodiesTable.returnedQuantity}`,
        deliveryNoteNumber: personalCustodiesTable.deliveryNoteNumber,
        deliveryDate: personalCustodiesTable.deliveryDate,
        location: personalCustodiesTable.location,
        status: personalCustodiesTable.status,
        sourceTransactionId: personalCustodiesTable.sourceTransactionId,
        createdAt: personalCustodiesTable.createdAt,
        updatedAt: personalCustodiesTable.updatedAt,
      })
      .from(personalCustodiesTable)
      .innerJoin(equipmentTable, eq(personalCustodiesTable.equipmentId, equipmentTable.id))
      .leftJoin(recipientsTable, eq(personalCustodiesTable.recipientId, recipientsTable.id))
      .where(eq(personalCustodiesTable.id, custodyId)),
    db
      .select({
        id: custodyReturnsTable.id,
        transactionId: custodyReturnsTable.transactionId,
        quantity: custodyReturnsTable.quantity,
        returnDate: custodyReturnsTable.returnDate,
        documentNumber: custodyReturnsTable.documentNumber,
        condition: custodyReturnsTable.condition,
        returnedToLocation: custodyReturnsTable.returnedToLocation,
        inspectionNotes: custodyReturnsTable.inspectionNotes,
        createdAt: custodyReturnsTable.createdAt,
        operatorName: usersTable.fullName,
      })
      .from(custodyReturnsTable)
      .leftJoin(usersTable, eq(custodyReturnsTable.createdBy, usersTable.id))
      .where(eq(custodyReturnsTable.custodyId, custodyId))
      .orderBy(asc(custodyReturnsTable.returnDate), asc(custodyReturnsTable.id)),
  ]);

  const custody = custodyRows[0];
  if (!custody) return null;

  const sourceTransaction = custody.sourceTransactionId
    ? await db
        .select({
          id: transactionsTable.id,
          type: transactionsTable.type,
          quantity: transactionsTable.quantity,
          documentNumber: transactionsTable.documentNumber,
          documentDate: transactionsTable.documentDate,
          custodyNoteNumber: transactionsTable.custodyNoteNumber,
          custodyDate: transactionsTable.custodyDate,
          custodyLocation: transactionsTable.custodyLocation,
          notes: transactionsTable.notes,
          createdAt: transactionsTable.createdAt,
          operatorName: usersTable.fullName,
        })
        .from(transactionsTable)
        .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
        .where(eq(transactionsTable.id, custody.sourceTransactionId))
        .then((rows) => rows[0] ?? null)
    : null;

  const returnedQuantity = Number(custody.returnedQuantity);
  const quantity = Number(custody.quantity);
  const outstandingQuantity = Math.max(0, quantity - returnedQuantity);
  const deliveryDate = new Date(`${custody.deliveryDate}T00:00:00Z`);
  const endDate = outstandingQuantity > 0 ? new Date() : new Date(`${returnRows.at(-1)?.returnDate ?? custody.deliveryDate}T00:00:00Z`);
  const daysHeld = Math.max(
    0,
    Math.floor((endDate.getTime() - deliveryDate.getTime()) / 86_400_000),
  );

  let returnedSoFar = 0;
  const events = [
    ...(sourceTransaction
      ? [
          {
            id: `transaction-${sourceTransaction.id}`,
            kind: "created",
            label: "إنشاء العهدة وتسليم التجهيز",
            date: sourceTransaction.documentDate ?? custody.deliveryDate,
            quantity: sourceTransaction.quantity === null ? quantity : Number(sourceTransaction.quantity),
            documentNumber: sourceTransaction.custodyNoteNumber ?? sourceTransaction.documentNumber,
            location: sourceTransaction.custodyLocation ?? custody.location,
            condition: null,
            notes: sourceTransaction.notes,
            operatorName: sourceTransaction.operatorName,
          },
        ]
      : [
          {
            id: "legacy-created",
            kind: "created",
            label: "إنشاء العهدة",
            date: custody.deliveryDate,
            quantity,
            documentNumber: custody.deliveryNoteNumber,
            location: custody.location,
            condition: null,
            notes: null,
            operatorName: null,
          },
        ]),
    ...returnRows.map((returned) => {
      returnedSoFar += Number(returned.quantity);
      return {
        id: `return-${returned.id}`,
        kind: returned.condition === "damaged" ? "damaged" : "returned",
        label: returnedSoFar >= quantity ? "إعادة كاملة" : "إعادة جزئية",
        date: returned.returnDate,
        quantity: Number(returned.quantity),
        documentNumber: returned.documentNumber,
        location: returned.returnedToLocation,
        condition: returned.condition,
        notes: returned.inspectionNotes,
        operatorName: returned.operatorName,
      };
    }),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    custody: {
      ...custody,
      quantity,
      returnedQuantity,
      outstandingQuantity,
      createdAt: asDate(custody.createdAt),
      updatedAt: asDate(custody.updatedAt),
      isOverdue: outstandingQuantity > 0 && daysHeld > 30,
      daysHeld,
    },
    equipment: {
      id: custody.equipmentId,
      name: custody.equipmentName,
      equipmentType: custody.equipmentType,
      model: custody.model,
      serialNumber: custody.serialNumber,
    },
    returns: returnRows.map((returned) => ({
      ...returned,
      quantity: Number(returned.quantity),
      createdAt: asDate(returned.createdAt),
    })),
    events,
  };
}