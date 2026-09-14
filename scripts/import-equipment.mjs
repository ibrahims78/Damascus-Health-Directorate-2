#!/usr/bin/env node
/**
 * استيراد بيانات التجهيزات من ملف Excel إلى جدول equipment
 *
 * الاستخدام:
 *   node scripts/import-equipment.mjs <مسار الملف>
 */

import { readFileSync } from "fs";
import { read, utils } from "xlsx";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }
const sql = postgres(DATABASE_URL);

const EXCEL_PATH = process.argv[2];
if (!EXCEL_PATH) {
  console.error("❌ يجب تمرير مسار ملف Excel:\n   node scripts/import-equipment.mjs <مسار الملف>");
  process.exit(1);
}

// ─── Column candidates ────────────────────────────────────────────────────────

const NAME_COLS          = ["الاسم", "اسم التجهيز", "التجهيز", "الجهاز"];
const TYPE_COLS          = ["نوع التجهيز", "النوع", "الفئة", "التصنيف"];
const MODEL_COLS         = ["الموديل", "الموديل / الطراز", "الطراز", "النموذج"];
const SERIAL_COLS        = ["الرقم التسلسلي", "الرقم التسلسلي (فريد)", "رقم السيريال", "Serial"];
const CONDITION_COLS     = ["الحالة", "حالة التجهيز", "الوضع"];
const QTY_COLS           = ["الكمية", "العدد", "عدد"];
const MIN_QTY_COLS       = ["الحد الأدنى للكمية", "الحد الأدنى", "الحد الادنى"];
const YEAR_COLS          = ["سنة الصنع", "سنة التصنيع", "سنة الإنتاج"];
const COUNTRY_COLS       = ["بلد المنشأ", "البلد", "المنشأ"];
const HOLDER_COLS        = ["الحائز الحالي", "الحائز", "المستخدم", "المسؤول"];
const NOTES_COLS         = ["ملاحظات", "ملاحظة", "تفاصيل"];

// Condition Arabic → DB value
const CONDITION_MAP = {
  "جيدة":        "good",
  "جيد":         "good",
  "تحت الصيانة": "maintenance",
  "صيانة":       "maintenance",
  "معطل":        "broken",
  "معطلة":       "broken",
  "مستهلك":      "consumed",
  "مستهلكة":     "consumed",
  "يحتاج فحص":  "needs_inspection",
  "يحتاج فحص":  "needs_inspection",
  "تحتاج فحص":  "needs_inspection",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeHeader(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s*\*+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickCol(headers, candidates) {
  const normedHeaders = headers.map(normalizeHeader);
  for (const c of candidates) {
    const nc = normalizeHeader(c);
    const idx = normedHeaders.findIndex(h => h.toLowerCase() === nc.toLowerCase());
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,،]/g, "").trim());
  return isNaN(n) ? null : Math.round(n);
}

function mapCondition(v) {
  if (!v) return "good";
  const s = String(v).trim();
  return CONDITION_MAP[s] ?? "good";
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

  for (const sheetName of workbook.SheetNames) {
    if (["التعليمات", "إحصائيات", "ملاحظات"].includes(sheetName)) {
      console.log(`⏭️  تخطي الورقة "${sheetName}"\n`);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows = utils.sheet_to_json(sheet, { header: 1, defval: null });

    const headerRowIdx = rawRows.findIndex(
      r => Array.isArray(r) && r.filter(c => c != null && String(c).trim()).length > 1
    );
    if (headerRowIdx < 0) {
      console.log(`⚠️  لا رؤوس في "${sheetName}" — تخطي\n`);
      continue;
    }

    const headers = rawRows[headerRowIdx].map(c => c != null ? String(c).trim() : "");
    const dataRows = rawRows.slice(headerRowIdx + 1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? null; });
      return obj;
    });

    console.log(`📋 الورقة: "${sheetName}" (${dataRows.length} صف)`);
    console.log(`   الأعمدة: ${headers.filter(Boolean).map(h => normalizeHeader(h)).join(" | ")}\n`);

    const nameCol      = pickCol(headers, NAME_COLS);
    const typeCol      = pickCol(headers, TYPE_COLS);
    const modelCol     = pickCol(headers, MODEL_COLS);
    const serialCol    = pickCol(headers, SERIAL_COLS);
    const conditionCol = pickCol(headers, CONDITION_COLS);
    const qtyCol       = pickCol(headers, QTY_COLS);
    const minQtyCol    = pickCol(headers, MIN_QTY_COLS);
    const yearCol      = pickCol(headers, YEAR_COLS);
    const countryCol   = pickCol(headers, COUNTRY_COLS);
    const holderCol    = pickCol(headers, HOLDER_COLS);
    const notesCol     = pickCol(headers, NOTES_COLS);

    if (!nameCol) {
      console.log(`   ⚠️  لم يُعثر على عمود الاسم — تخطي\n`);
      continue;
    }

    let sheetImported = 0, sheetSkipped = 0;

    for (const row of dataRows) {
      const name = String(row[nameCol] ?? "").trim();
      if (!name || name === "—" || name === "-") { sheetSkipped++; continue; }

      const equipmentType  = typeCol      ? String(row[typeCol] ?? "").trim() || null : null;
      const model          = modelCol     ? String(row[modelCol] ?? "").trim() || null : null;
      let   serialNumber   = serialCol    ? String(row[serialCol] ?? "").trim() || null : null;
      const conditionAr    = conditionCol ? String(row[conditionCol] ?? "").trim() : null;
      const condition      = mapCondition(conditionAr);
      const quantity       = qtyCol       ? (toNumber(row[qtyCol]) ?? 1) : 1;
      const minQuantity    = minQtyCol    ? (toNumber(row[minQtyCol]) ?? 0) : 0;
      const manufactureYear = yearCol     ? toNumber(row[yearCol]) : null;
      const originCountry  = countryCol   ? String(row[countryCol] ?? "").trim() || null : null;
      const currentHolder  = holderCol    ? String(row[holderCol] ?? "").trim() || null : null;
      const notes          = notesCol     ? String(row[notesCol] ?? "").trim() || null : null;

      // Serial number valid only for quantity=1
      if (serialNumber && quantity > 1) {
        console.log(`   ⚠️  ${name}: الرقم التسلسلي مع كمية ${quantity} — إلغاء الرقم التسلسلي`);
        serialNumber = null;
      }

      try {
        // Check if already exists by name (idempotent)
        const existing = await sql`
          SELECT id FROM equipment WHERE name = ${name} LIMIT 1
        `;
        if (existing.length > 0) {
          console.log(`   ⏭️  ${name} — موجود مسبقاً، تخطي`);
          sheetSkipped++;
          continue;
        }

        // Handle serial number uniqueness: if serial exists, skip serial
        if (serialNumber) {
          const serialExists = await sql`
            SELECT id FROM equipment WHERE serial_number = ${serialNumber} LIMIT 1
          `;
          if (serialExists.length > 0) {
            console.log(`   ⚠️  ${name}: الرقم التسلسلي ${serialNumber} مكرر — سيُضاف بدون رقم تسلسلي`);
            serialNumber = null;
          }
        }

        await sql`
          INSERT INTO equipment
            (name, equipment_type, model, serial_number, condition, quantity, min_quantity,
             manufacture_year, origin_country, current_holder, notes)
          VALUES (
            ${name}, ${equipmentType}, ${model}, ${serialNumber}, ${condition},
            ${quantity}, ${minQuantity}, ${manufactureYear}, ${originCountry},
            ${currentHolder}, ${notes}
          )
        `;

        sheetImported++;
        console.log(`   ✅ ${name} | ${condition}${quantity > 1 ? ` ×${quantity}` : ""}${serialNumber ? ` | SN: ${serialNumber}` : ""}`);
      } catch (err) {
        console.error(`   ❌ خطأ: "${name}": ${err.message}`);
        totalErrors++;
      }
    }

    console.log(`\n   🔧 "${sheetName}": ${sheetImported} مستورد، ${sheetSkipped} متخطى\n`);
    totalImported += sheetImported;
    totalSkipped  += sheetSkipped;
  }

  await sql.end();
  console.log("─".repeat(50));
  console.log(`\n🎉 اكتمل استيراد التجهيزات:`);
  console.log(`   ✅ مستورد  : ${totalImported}`);
  console.log(`   ⏭️  متخطى  : ${totalSkipped}`);
  console.log(`   ❌ أخطاء  : ${totalErrors}\n`);
}

main().catch(err => { console.error("خطأ فادح:", err); process.exit(1); });
