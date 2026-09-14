import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { utils, write } from "xlsx";

const workspaceRoot = process.env.INIT_CWD || join(process.cwd(), "..");
const root = join(workspaceRoot, "fixtures", "inventory-phase0");
const headers = [
  "code",
  "name",
  "categoryName",
  "unit",
  "currentStock",
  "minStock",
  "expiryDate",
  "batchNumber",
  "supplier",
  "location",
  "notes",
];

function workbook(rows = []) {
  const sheet = utils.aoa_to_sheet([headers, ...rows]);
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, "البيانات");
  return write(book, { type: "buffer", bookType: "xlsx" });
}

const files = {
  "01-empty-template.xlsx": workbook(),
  "02-export-baseline.xlsx": workbook([
    ["PH0-EXPORT-001", "شاش معقم - عينة", "مستلزمات صحية", "علبة", 12, 3, "2027-01-31", "FIX-B-001", "مورد اختباري", "رف A-01", "بيانات اصطناعية"],
  ]),
  "03-new-item.xlsx": workbook([
    ["PH0-NEW-001", "قفازات فحص - عينة", "مستلزمات صحية", "علبة", 0, 2, "", "", "", "رف A-02", "مادة اختبارية جديدة"],
  ]),
  "04-batch-input.xlsx": workbook([
    ["PH0-BATCH-001", "محلول ملحي - عينة", "مستلزمات صحية", "زجاجة", 25, 5, "2027-06-30", "FIX-B-002", "مورد اختباري", "رف B-01", "دفعة اختبارية"],
  ]),
  "05-intentional-errors.xlsx": workbook([
    ["PH0-ERR-001", "", "مستلزمات صحية", "علبة", 1, 0, "", "", "", "", "اسم مفقود"],
    ["PH0-ERR-002", "كمية سالبة - عينة", "مستلزمات صحية", "علبة", -2, 0, "", "", "", "", "كمية سالبة"],
    ["PH0-ERR-003", "تاريخ غير صالح - عينة", "تصنيف غير موجود", "علبة", 1, 0, "2026-02-31", "", "", "", "تصنيف وتاريخ غير صالحين"],
  ]),
};

await mkdir(root, { recursive: true });
const manifest = {
  generatedAt: "2026-09-09",
  purpose: "phase-0-baseline",
  dataPolicy: "synthetic-only",
  files: {},
};

for (const [name, data] of Object.entries(files)) {
  const path = join(root, name);
  await writeFile(path, data);
  manifest.files[name] = {
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
  };
}

await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${Object.keys(files).length} phase-0 fixtures in ${root}`);