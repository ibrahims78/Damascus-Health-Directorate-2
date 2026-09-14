import { Router } from "express";
import {
  db,
  itemsTable,
  equipmentTable,
  transactionsTable,
  usersTable,
  systemSettingsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { eq, and, sql } from "drizzle-orm";

const router = Router();

// GET /api/dashboard/stats
router.get("/stats", requireAuth, async (_req, res) => {
  try {
    // Read expiryAlertDays from system settings (default: 30)
    const settings = await db.query.systemSettingsTable.findFirst();
    const alertDays = settings?.expiryAlertDays ?? 30;

    // Use UTC explicitly to avoid timezone drift on the server
    const nowUtc = new Date();
    const alertDate = new Date(nowUtc);
    alertDate.setUTCDate(alertDate.getUTCDate() + alertDays);
    const alertDateStr = alertDate.toISOString().split("T")[0];
    const today = nowUtc.toISOString().split("T")[0];
    const stagnantCutoff = new Date(nowUtc);
    stagnantCutoff.setUTCMonth(stagnantCutoff.getUTCMonth() - 7);
    const monthStart = new Date(
      Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1)
    );
    const prevMonthStart = new Date(
      Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1)
    );

    const [
      totalItemsResult,
      belowMinResult,
      nearExpiryResult,
      expiredResult,
      zeroStockResult,
      stagnantItemsResult,
      totalEquipmentResult,
      equipmentAlertResult,
      monthlyInResult,
      monthlyOutResult,
      prevMonthInResult,
      prevMonthOutResult,
      recentTransactionsResult,
    ] = await Promise.all([
      // Total active items
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(eq(itemsTable.isActive, true)),

      // Below min stock (stock < min, strictly; excludes zero-stock items counted separately)
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            sql`${itemsTable.currentStock} < ${itemsTable.minStock}`,
            sql`${itemsTable.currentStock} > 0`,
            sql`${itemsTable.minStock} > 0`
          )
        ),

      // Near expiry: within alertDays window, not yet expired
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            sql`${itemsTable.expiryDate} IS NOT NULL
                AND ${itemsTable.expiryDate} > ${today}
                AND ${itemsTable.expiryDate} <= ${alertDateStr}`
          )
        ),

      // Already expired (expiryDate <= today — includes items expiring exactly today)
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            sql`${itemsTable.expiryDate} IS NOT NULL AND ${itemsTable.expiryDate} <= ${today}`
          )
        ),

      // Zero stock (active items with currentStock = 0)
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            sql`${itemsTable.currentStock} = 0`
          )
        ),

      // Stocked active items whose latest item movement is older than seven
      // months. Items with no recorded movement use their creation date.
      db
        .select({ count: sql<number>`count(*)` })
        .from(itemsTable)
        .where(
          and(
            eq(itemsTable.isActive, true),
            sql`${itemsTable.currentStock} > 0`,
            sql`COALESCE(
              (
                SELECT MAX(t.created_at)
                FROM transactions t
                WHERE t.item_id = ${itemsTable.id}
                  AND t.item_type = 'item'
              ),
              ${itemsTable.createdAt}
            ) < ${stagnantCutoff}`,
          ),
        ),

      // Total equipment — excludes consumed (scrapped/written-off) units
      db
        .select({ count: sql<number>`count(*)` })
        .from(equipmentTable)
        .where(sql`${equipmentTable.condition} != 'consumed'`),

      // Equipment in maintenance, needs inspection, or broken (excludes consumed)
      db
        .select({ count: sql<number>`count(*)` })
        .from(equipmentTable)
        .where(
          sql`${equipmentTable.condition} IN ('maintenance', 'needs_inspection', 'broken')`
        ),

      // Transactions this month (in)
      db
        .select({ count: sql<number>`count(*)` })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.type, "in"),
            sql`${transactionsTable.createdAt} >= ${monthStart}`
          )
        ),

      // Transactions this month (out)
      db
        .select({ count: sql<number>`count(*)` })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.type, "out"),
            sql`${transactionsTable.createdAt} >= ${monthStart}`
          )
        ),

      // Transactions previous month (in)
      db
        .select({ count: sql<number>`count(*)` })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.type, "in"),
            sql`${transactionsTable.createdAt} >= ${prevMonthStart}`,
            sql`${transactionsTable.createdAt} < ${monthStart}`
          )
        ),

      // Transactions previous month (out)
      db
        .select({ count: sql<number>`count(*)` })
        .from(transactionsTable)
        .where(
          and(
            eq(transactionsTable.type, "out"),
            sql`${transactionsTable.createdAt} >= ${prevMonthStart}`,
            sql`${transactionsTable.createdAt} < ${monthStart}`
          )
        ),

      // Last 5 transactions with item/equipment name and user
      db
        .select({
          id: transactionsTable.id,
          type: transactionsTable.type,
          itemType: transactionsTable.itemType,
          quantity: transactionsTable.quantity,
          documentNumber: transactionsTable.documentNumber,
          itemName: itemsTable.name,
          equipmentName: equipmentTable.name,
          createdAt: transactionsTable.createdAt,
          createdByName: usersTable.fullName,
        })
        .from(transactionsTable)
        .leftJoin(itemsTable, eq(transactionsTable.itemId, itemsTable.id))
        .leftJoin(
          equipmentTable,
          eq(transactionsTable.equipmentId, equipmentTable.id)
        )
        .leftJoin(usersTable, eq(transactionsTable.createdBy, usersTable.id))
        .orderBy(sql`${transactionsTable.createdAt} DESC`)
        .limit(5),
    ]);

    res.json({
      totalItems: Number(totalItemsResult[0]?.count ?? 0),
      belowMinCount: Number(belowMinResult[0]?.count ?? 0),
      nearExpiryCount: Number(nearExpiryResult[0]?.count ?? 0),
      expiredCount: Number(expiredResult[0]?.count ?? 0),
      zeroStockCount: Number(zeroStockResult[0]?.count ?? 0),
      stagnantItemsCount: Number(stagnantItemsResult[0]?.count ?? 0),
      totalEquipment: Number(totalEquipmentResult[0]?.count ?? 0),
      equipmentAlertCount: Number(equipmentAlertResult[0]?.count ?? 0),
      monthlyIn: Number(monthlyInResult[0]?.count ?? 0),
      monthlyOut: Number(monthlyOutResult[0]?.count ?? 0),
      prevMonthIn: Number(prevMonthInResult[0]?.count ?? 0),
      prevMonthOut: Number(prevMonthOutResult[0]?.count ?? 0),
      expiryAlertDays: alertDays,
      recentTransactions: recentTransactionsResult.map((t) => ({
        id: t.id,
        type: t.type,
        itemType: t.itemType,
        quantity: t.quantity,
        documentNumber: t.documentNumber,
        name: t.itemName ?? t.equipmentName ?? "—",
        createdAt: t.createdAt,
        createdByName: t.createdByName ?? "—",
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/charts
router.get("/charts", requireAuth, async (_req, res) => {
  try {
    const [topItems, stockByCategory, dailyMovement] = await Promise.all([
      // Top 8 most-active items (last 30 days) — sorted by total activity (in+out)
      db.execute(sql`
        SELECT
          i.name,
          SUM(CASE WHEN t.type = 'out' THEN COALESCE(t.quantity, 0) ELSE 0 END)::int AS out_qty,
          SUM(CASE WHEN t.type = 'in'  THEN COALESCE(t.quantity, 0) ELSE 0 END)::int AS in_qty
        FROM transactions t
        JOIN items i ON t.item_id = i.id
        WHERE t.item_type = 'item'
          AND t.created_at >= NOW() - INTERVAL '30 days'
          AND t.type IN ('in', 'out')
          AND i.is_active = true
        GROUP BY i.id, i.name
        ORDER BY (SUM(COALESCE(t.quantity, 0))) DESC
        LIMIT 8
      `),

      // Stock distribution by category — quantity-based, exclude zero-stock categories
      db.execute(sql`
        SELECT
          COALESCE(c.name, 'غير مصنف') AS category,
          SUM(i.current_stock)::int     AS total_stock,
          COUNT(i.id)::int              AS item_count
        FROM items i
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE i.is_active = true
        GROUP BY c.id, c.name
        HAVING SUM(i.current_stock) > 0
        ORDER BY total_stock DESC
      `),

      // Daily movement — ALL 30 days, zeros for days with no activity.
      // generate_series ensures every day appears even if there are no transactions.
      // Type filter is in the JOIN condition (not WHERE) so empty days still appear.
      db.execute(sql`
        SELECT
          TO_CHAR(gs.d::date, 'DD/MM') AS day,
          COALESCE(SUM(CASE WHEN t.type = 'in'  THEN COALESCE(t.quantity, 0) ELSE 0 END), 0)::int AS in_qty,
          COALESCE(SUM(CASE WHEN t.type = 'out' THEN COALESCE(t.quantity, 0) ELSE 0 END), 0)::int AS out_qty,
          COUNT(t.id)::int AS tx_count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '29 days',
          CURRENT_DATE,
          '1 day'::interval
        ) AS gs(d)
        LEFT JOIN transactions t
          ON DATE(t.created_at) = gs.d::date
          AND t.type IN ('in', 'out')
        GROUP BY gs.d
        ORDER BY gs.d ASC
      `),
    ]);

    res.json({
      topItems: (
        topItems.rows as Array<{
          name: string;
          out_qty: number;
          in_qty: number;
        }>
      ).map((r) => ({
        name: r.name,
        outQty: Number(r.out_qty),
        inQty: Number(r.in_qty),
      })),

      stockByCategory: (
        stockByCategory.rows as Array<{
          category: string;
          total_stock: number;
          item_count: number;
        }>
      ).map((r) => ({
        category: r.category,
        totalStock: Number(r.total_stock),
        itemCount: Number(r.item_count),
      })),

      dailyMovement: (
        dailyMovement.rows as Array<{
          day: string;
          in_qty: number;
          out_qty: number;
          tx_count: number;
        }>
      ).map((r) => ({
        day: r.day,
        inQty: Number(r.in_qty),
        outQty: Number(r.out_qty),
        txCount: Number(r.tx_count),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
