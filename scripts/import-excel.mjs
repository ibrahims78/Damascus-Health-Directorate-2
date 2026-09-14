#!/usr/bin/env node
/**
 * استيراد بيانات المخزون الأولي من ملف Excel (المواد والمستهلكات والثوابت)
 *
 * الاستخدام:
 *   node scripts/import-excel.mjs <مسار الملف>
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { read, utils } from "xlsx";
import postgres from "postgres";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── DB ──────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }
const sql = postgres(DATABASE_URL);

const EXCEL_PATH = process.argv[2];
if (!EXCEL_PATH) {
  console.error("❌ يجب تمرير مسار ملف Excel:\n   node scripts/import-excel.mjs <مسار الملف>");
  process.exit(1);
}

// ─── Column candidates ────────────────────────────────────────────────────────
// Column names normalized: strip trailing " *", leading/trailing spaces, collapse inner spaces

const NAME_COLS     = ["الاسم", "اسم المادة", "الصنف", "اسم الصنف", "المادة", "البيان", "الجهاز"];
const QTY_COLS      = ["الكمية الحالية", "الكمية", "عدد", "العدد", "الرصيد", "الرصيد الحالي"];
const UNIT_COLS     = ["الوحدة", "وحدة القياس", "الوحدة القياسية"];
const CATEGORY_COLS = ["التصنيف", "الفئة", "القسم"];
const MIN_STOCK_COLS = ["الحد الأدنى", "الحد الادنى", "الحد الأدنى للمخزون"];
const EXPIRY_COLS   = ["تاريخ الانتهاء", "تاريخ انتهاء الصلاحية", "الصلاحية"];
const BATCH_COLS    = ["رقم الدفعة", "رقم الدُّفعة", "الدفعة"];
const SUPPLIER_COLS = ["المورد", "اسم المورد", "الموردون"];
const LOCATION_COLS = ["الموقع", "مكان التخزين", "موقع التخزين"];
const CODE_COLS     = ["الرمز", "الكود", "الرقم", "رقم المادة"];

const SHEET_ITEM_TYPE = {
  "المستهلكات الطبية": "consumable",
  "مستهلكات منوعة":   "consumable",
  "الثوابت":          "fixed",
  "البيانات":         "consumable", // default sheet name in template
};
const DEFAULT_ITEM_TYPE = "consumable";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize a header: strip " *" suffix, trim, collapse inner spaces */
function normalizeHeader(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s*\*+\s*$/, "")   // remove trailing asterisks with surrounding spaces
    .replace(/\s+/g, " ")
    .trim();
}

function pickCol(headers, candidates) {
  const normedHeaders = headers.map(normalizeHeader);
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const idx = normedHeaders.findIndex(h => h.toLowerCase() === nc.toLowerCase());
    if (idx >= 0) return headers[idx]; // return the original header key
  }
  return null;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,،]/g, "").trim());
  return isNaN(n) ? null : Math.round(n);
}

function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.toISOString().split("T")[0];
  }
  const s = String(v).trim();
  if (!s || s === "-" || s === "—") return null;
  // Try parsing common formats
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📂 قراءة الملف: ${EXCEL_PATH}\n`);

  let fileBuffer;
  try { fileBuffer = readFileSync(EXCEL_PATH); }
  catch { console.error(`❌ الملف غير موجود: ${EXCEL_PATH}`); process.exit(1); }

  const workbook = read(fileBuffer, { type: "buffer", cellDates: true });
  console.log(`📊 الأوراق المتاحة: ${workbook.SheetNames.join(", ")}\n`);

  let totalImported = 0, totalSkipped = 0, totalErrors = 0;

  const adminRows = await sql`SELECT id FROM users WHERE username = 'admin' LIMIT 1`;
  const adminId = adminRows[0]?.id ?? null;

  for (const sheetName of workbook.SheetNames) {
    // Skip instruction/stats sheets
    if (["التعليمات", "إحصائيات", "ملاحظات"].includes(sheetName)) {
      console.log(`⏭️  تخطي الورقة "${sheetName}" (تعليمات)\n`);
      continue;
    }

    const sheetItemType = SHEET_ITEM_TYPE[sheetName] ?? DEFAULT_ITEM_TYPE;
    const sheet = workbook.Sheets[sheetName];
    const rawRows = utils.sheet_to_json(sheet, { header: 1, defval: null });

    // Find header row: first row with > 1 non-empty cell
    const headerRowIdx = rawRows.findIndex(
      r => Array.isArray(r) && r.filter(c => c != null && String(c).trim()).length > 1
    );
    if (headerRowIdx < 0) {
      console.log(`⚠️  لم يُعثر على رؤوس في "${sheetName}" — تخطي\n`);
      continue;
    }

    const headers = rawRows[headerRowIdx].map(c => c != null ? String(c).trim() : "");
    const dataRows = rawRows.slice(headerRowIdx + 1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? null; });
      return obj;
    });

    console.log(`📋 الورقة: "${sheetName}" → نوع: ${sheetItemType} (${dataRows.length} صف)`);
    console.log(`   الأعمدة: ${headers.filter(Boolean).map(h => normalizeHeader(h)).join(" | ")}\n`);

    const nameCol     = pickCol(headers, NAME_COLS);
    const qtyCol      = pickCol(headers, QTY_COLS);
    const unitCol     = pickCol(headers, UNIT_COLS);
    const categoryCol = pickCol(headers, CATEGORY_COLS);
    const minStockCol = pickCol(headers, MIN_STOCK_COLS);
    const expiryCol   = pickCol(headers, EXPIRY_COLS);
    const batchCol    = pickCol(headers, BATCH_COLS);
    const supplierCol = pickCol(headers, SUPPLIER_COLS);
    const locationCol = pickCol(headers, LOCATION_COLS);
    const codeCol     = pickCol(headers, CODE_COLS);

    if (!nameCol) {
      console.log(`   ⚠️  لم يُعثر على عمود الاسم — تخطي الورقة\n`);
      continue;
    }

    console.log(`   عمود الاسم: "${nameCol}"${qtyCol ? ` | الكمية: "${qtyCol}"` : ""}\n`);

    let sheetImported = 0, sheetSkipped = 0;

    for (const row of dataRows) {
      const name = String(row[nameCol] ?? "").trim();
      if (!name || name === "—" || name === "-") { sheetSkipped++; continue; }

      const qty       = qtyCol      ? toNumber(row[qtyCol])             : null;
      const unit      = unitCol     ? String(row[unitCol] ?? "").trim() || null : null;
      const minStock  = minStockCol ? (toNumber(row[minStockCol]) ?? 0) : 0;
      const expiry    = expiryCol   ? toDateStr(row[expiryCol])         : null;
      const batch     = batchCol    ? String(row[batchCol] ?? "").trim() || null : null;
      const supplier  = supplierCol ? String(row[supplierCol] ?? "").trim() || null : null;
      const location  = locationCol ? String(row[locationCol] ?? "").trim() || null : null;
      const code      = codeCol     ? String(row[codeCol] ?? "").trim() || null : null;
      const categoryName = categoryCol ? String(row[categoryCol] ?? "").trim() || null : null;

      try {
        const categoryType = sheetItemType === "fixed" ? "consumable" : sheetItemType;

        let categoryId = null;
        if (categoryName) {
          const existing = await sql`SELECT id FROM categories WHERE name = ${categoryName} LIMIT 1`;
          if (existing.length > 0) {
            categoryId = existing[0].id;
          } else {
            const inserted = await sql`
              INSERT INTO categories (name, type)
              VALUES (${categoryName}, ${categoryType})
              ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type
              RETURNING id
            `;
            categoryId = inserted[0]?.id ?? null;
          }
        }

        const existingItem = await sql`
          SELECT id FROM items WHERE name = ${name} AND is_active = true LIMIT 1
        `;

        let itemId;
        if (existingItem.length > 0) {
          itemId = existingItem[0].id;
          const existingTx = await sql`
            SELECT id FROM transactions WHERE item_id = ${itemId} AND type = 'init' LIMIT 1
          `;
          if (existingTx.length > 0) {
            console.log(`   ⏭️  ${name} — رصيد افتتاحي موجود، تخطي`);
            sheetSkipped++;
            continue;
          }
          const [stockRow] = await sql`SELECT current_stock FROM items WHERE id = ${itemId}`;
          if ((stockRow?.current_stock ?? 0) === 0 && qty !== null && qty > 0) {
            await sql`
              UPDATE items SET
                current_stock = ${qty},
                min_stock     = ${minStock},
                unit          = COALESCE(NULLIF(${unit ?? ""}, ''), unit),
                category_id   = COALESCE(${categoryId}, category_id),
                expiry_date   = COALESCE(${expiry}, expiry_date),
                batch_number  = COALESCE(${batch}, batch_number),
                supplier      = COALESCE(${supplier}, supplier),
                location      = COALESCE(${location}, location),
                updated_at    = NOW()
              WHERE id = ${itemId}
            `;
          }
        } else {
          const inserted = await sql`
            INSERT INTO items
              (name, code, unit, item_type, category_id, current_stock, min_stock,
               expiry_date, batch_number, supplier, location)
            VALUES (
              ${name}, ${code}, ${unit ?? "وحدة"}, ${sheetItemType}, ${categoryId},
              ${qty ?? 0}, ${minStock}, ${expiry}, ${batch}, ${supplier}, ${location}
            )
            RETURNING id
          `;
          itemId = inserted[0]?.id;
        }

        if (qty !== null && qty > 0 && itemId) {
          const countResult = await sql`SELECT count(*) FROM transactions WHERE type = 'init'`;
          const seq = Number(countResult[0].count) + 1;
          const docNum = `INIT-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;

          await sql`
            INSERT INTO transactions
              (type, item_type, item_id, quantity, document_number, notes, created_by)
            VALUES
              ('init', 'item', ${itemId}, ${qty}, ${docNum},
               ${"رصيد افتتاحي — استيراد من ملف Excel"}, ${adminId})
          `;
        }

        sheetImported++;
        console.log(`   ✅ ${name}${qty !== null ? ` (${qty}${unit ? " " + unit : ""})` : ""}${expiry ? ` | انتهاء: ${expiry}` : ""}`);
      } catch (err) {
        console.error(`   ❌ خطأ: "${name}": ${err.message}`);
        totalErrors++;
      }
    }

    console.log(`\n   📦 "${sheetName}": ${sheetImported} مستورد، ${sheetSkipped} متخطى\n`);
    totalImported += sheetImported;
    totalSkipped  += sheetSkipped;
  }

  await sql.end();
  console.log("─".repeat(50));
  console.log(`\n🎉 اكتمل الاستيراد:`);
  console.log(`   ✅ مستورد  : ${totalImported}`);
  console.log(`   ⏭️  متخطى  : ${totalSkipped}`);
  console.log(`   ❌ أخطاء  : ${totalErrors}\n`);
}

main().catch(err => { console.error("خطأ فادح:", err); process.exit(1); });
