import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

const migration = await readFile(
  new URL("../drizzle/0007_phase2_inventory_policy.sql", import.meta.url),
  "utf8",
);

async function createLegacyDatabase() {
  const client = new PGlite();
  await client.exec(`
    CREATE TABLE items (
      id serial PRIMARY KEY,
      current_stock integer NOT NULL DEFAULT 0,
      min_stock integer NOT NULL DEFAULT 0,
      expiry_date date,
      batch_number text,
      supplier text
    );
    CREATE TABLE transactions (
      id serial PRIMARY KEY,
      document_number text NOT NULL
    );
    CREATE TABLE inventory_batches (
      id serial PRIMARY KEY,
      item_id integer NOT NULL REFERENCES items(id),
      batch_number text,
      received_quantity integer NOT NULL,
      remaining_quantity integer NOT NULL,
      expiry_date date,
      delivery_note_number text,
      delivery_note_date date,
      supply_source text NOT NULL DEFAULT 'central_warehouses',
      source_transaction_id integer REFERENCES transactions(id)
    );
  `);
  return client;
}

async function columns(client: PGlite) {
  const result = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_name IN ('items', 'inventory_batches')
       AND column_name IN ('requires_expiry_tracking', 'requires_batch_tracking', 'supplier')
     ORDER BY table_name, column_name`,
  );
  return result.rows;
}

describe("phase 2 inventory migration", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = await createLegacyDatabase();
  });

  afterEach(async () => {
    await client.close();
  });

  it("applies to an empty database and is idempotent", async () => {
    await client.exec(migration);
    await client.exec(migration);
    expect(await columns(client)).toEqual([
      { table_name: "inventory_batches", column_name: "supplier" },
      { table_name: "items", column_name: "requires_batch_tracking" },
      { table_name: "items", column_name: "requires_expiry_tracking" },
      { table_name: "items", column_name: "supplier" },
    ]);
    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'inventory_batches_item_fefo_idx'`,
    );
    expect(indexes.rows).toHaveLength(1);
  });

  it("preserves legacy material, batch, and movement data", async () => {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO items (current_stock, min_stock, expiry_date, batch_number, supplier)
       VALUES (9, 2, '2026-12-31', 'LEGACY-B-1', 'Legacy supplier') RETURNING id`,
    );
    const itemId = inserted.rows[0].id;
    const transaction = await client.query<{ id: number }>(
      `INSERT INTO transactions (document_number) VALUES ('LEGACY-DOC-1') RETURNING id`,
    );
    await client.query(
      `INSERT INTO inventory_batches
       (item_id, batch_number, received_quantity, remaining_quantity, expiry_date,
        delivery_note_number, delivery_note_date, source_transaction_id)
       VALUES ($1, 'LEGACY-B-1', 9, 9, '2026-12-31', 'LEGACY-DOC-1', '2026-09-09', $2)`,
      [itemId, transaction.rows[0].id],
    );

    await client.exec(migration);

    const preserved = await client.query<{
      current_stock: number;
      batch_number: string;
      source_transaction_id: number;
      supplier: string | null;
      requires_expiry_tracking: boolean;
      requires_batch_tracking: boolean;
    }>(
      `SELECT i.current_stock, b.batch_number, b.source_transaction_id, b.supplier,
              i.requires_expiry_tracking, i.requires_batch_tracking
       FROM items i JOIN inventory_batches b ON b.item_id = i.id`,
    );
    expect(preserved.rows[0]).toMatchObject({
      current_stock: 9,
      batch_number: "LEGACY-B-1",
      source_transaction_id: transaction.rows[0].id,
      supplier: null,
      requires_expiry_tracking: false,
      requires_batch_tracking: false,
    });

    await client.query(
      `INSERT INTO inventory_batches
       (item_id, batch_number, received_quantity, remaining_quantity, expiry_date,
        delivery_note_number, delivery_note_date)
       VALUES ($1, 'EARLY', 2, 2, '2026-10-01', 'DOC-EARLY', '2026-09-09')`,
      [itemId],
    );
    const fefo = await client.query<{ batch_number: string }>(
      `SELECT batch_number FROM inventory_batches
       WHERE item_id = $1 AND remaining_quantity > 0
       ORDER BY expiry_date ASC NULLS LAST, id ASC`,
      [itemId],
    );
    expect(fefo.rows[0].batch_number).toBe("EARLY");
  });
});