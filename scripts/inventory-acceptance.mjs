import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import XLSX from "xlsx";

const execFile = promisify(execFileCallback);
const root = resolve(new URL("..", import.meta.url).pathname);
const apiRoot = join(root, "artifacts", "api-server");
const port = Number(process.env.INVENTORY_ACCEPTANCE_PORT ?? 8184);
const password = process.env.SEED_ADMIN_PASSWORD ?? "InventoryAccept!2026";
const timeoutMs = Number(process.env.INVENTORY_ACCEPTANCE_TIMEOUT_MS ?? 20_000);
const itemCode = `ACC-${Date.now().toString().slice(-8)}`;
const itemName = `اختبار قبول تعدد الدفعات ${itemCode}`;

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `: ${JSON.stringify(details)}`;
    throw new Error(`${message}${suffix}`);
  }
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      ...options,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = error.stdout ? `\nstdout:\n${error.stdout}` : "";
    const stderr = error.stderr ? `\nstderr:\n${error.stderr}` : "";
    throw new Error(`فشل الأمر ${command} ${args.join(" ")}${stdout}${stderr}`);
  }
}

function makeWorkbook(filePath) {
  const itemHeaders = ["الرمز", "الاسم", "الوحدة", "التصنيف", "الحد الأدنى", "الموقع", "ملاحظات"];
  const batchHeaders = [
    "رمز المادة",
    "الكمية الافتتاحية",
    "رقم الدفعة",
    "تاريخ الصلاحية",
    "المورد",
    "رقم سند الإدخال",
    "تاريخ سند الإدخال",
  ];
  const workbook = XLSX.utils.book_new();
  const items = XLSX.utils.aoa_to_sheet([
    itemHeaders,
    [itemCode, itemName, "قطعة", "", 0, "رف قبول", "ملف قبول XLSX"],
  ]);
  const batches = XLSX.utils.aoa_to_sheet([
    batchHeaders,
    [itemCode, 5, "ACC-EARLY", "2027-01-01", "مورد القبول", "ACC-GRN-1", "2027-01-01"],
    [itemCode, 7, "ACC-LATE", "2028-01-01", "مورد القبول", "ACC-GRN-2", "2028-01-01"],
  ]);
  XLSX.utils.book_append_sheet(workbook, items, "المواد");
  XLSX.utils.book_append_sheet(workbook, batches, "الأرصدة والدفعات الافتتاحية");
  XLSX.writeFile(workbook, filePath, { bookType: "xlsx" });
}

function makeWorkbookFromExport(filePath, exported) {
  const workbook = XLSX.utils.book_new();
  const itemRows = [
    ["الرمز", "الاسم", "الوحدة", "التصنيف", "الحد الأدنى", "الموقع", "ملاحظات"],
    ...exported.items.map((item) => [
      item.code,
      item.name,
      item.unit,
      item.categoryName,
      item.minStock,
      item.location,
      item.notes,
    ]),
  ];
  const batchRows = [
    [
      "رمز المادة",
      "الكمية الافتتاحية",
      "رقم الدفعة",
      "تاريخ الصلاحية",
      "المورد",
      "رقم سند الإدخال",
      "تاريخ سند الإدخال",
    ],
    ...exported.openingBatches.map((batch) => [
      batch.code,
      batch.quantity,
      batch.batchNumber,
      batch.expiryDate,
      batch.supplier,
      batch.deliveryNoteNumber,
      batch.deliveryNoteDate,
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(itemRows), "المواد");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(batchRows),
    "الأرصدة والدفعات الافتتاحية",
  );
  XLSX.writeFile(workbook, filePath, { bookType: "xlsx" });
}

function readWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  assert(workbook.SheetNames.includes("المواد"), "ورقة المواد غير قابلة للقراءة");
  assert(
    workbook.SheetNames.includes("الأرصدة والدفعات الافتتاحية"),
    "ورقة الدفعات غير قابلة للقراءة",
  );
  return {
    items: XLSX.utils.sheet_to_json(workbook.Sheets["المواد"], { defval: "" }),
    openingBatches: XLSX.utils.sheet_to_json(
      workbook.Sheets["الأرصدة والدفعات الافتتاحية"],
      { defval: "" },
    ),
  };
}

function startApi(dataDir) {
  const { DATABASE_URL: _databaseUrl, ...environment } = process.env;
  const child = spawn("node", ["--enable-source-maps", "dist/index.mjs"], {
    cwd: apiRoot,
    env: {
      ...environment,
      DAMASCUS_DESKTOP: "1",
      DAMASCUS_SCHEMA_PATH: join(root, "lib", "db", "desktop-schema.sql"),
      DAMASCUS_DATA_DIR: dataDir,
      NODE_ENV: "test",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stderr.write(`[acceptance-api] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[acceptance-api] ${chunk}`));
  return child;
}

async function stopApi(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = "";
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, payload };
  }
}

async function waitForHealth(client) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await client.request("/api/healthz");
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("لم تبدأ خدمة API خلال المهلة المحددة");
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), "dme-inventory-acceptance-"));
  const workbookPath = join(dataDir, "inventory-acceptance.xlsx");
  let api;
  try {
    await run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], { cwd: root });
    await run("node", ["build-seed.mjs"], { cwd: apiRoot });

    // First boot creates the isolated Desktop/PGlite schema; then seed it.
    api = startApi(dataDir);
    const bootstrapClient = new Client(`http://127.0.0.1:${port}`);
    await waitForHealth(bootstrapClient);
    await stopApi(api);
    api = null;
    await run("node", ["--enable-source-maps", "dist/seed.mjs"], {
      cwd: apiRoot,
      env: {
        ...process.env,
        DAMASCUS_DESKTOP: "1",
        DAMASCUS_SCHEMA_PATH: join(root, "lib", "db", "desktop-schema.sql"),
        DAMASCUS_DATA_DIR: dataDir,
        SEED_ADMIN_PASSWORD: password,
      },
    });

    api = startApi(dataDir);
    const client = new Client(`http://127.0.0.1:${port}`);
    await waitForHealth(client);

    const login = await client.request("/api/auth/login", {
      method: "POST",
      body: { username: "admin", password },
    });
    assert(login.status === 200, "فشل تسجيل دخول اختبار القبول", login);

    makeWorkbook(workbookPath);
    const payload = readWorkbook(workbookPath);
    assert(payload.items.length === 1, "لم تتم قراءة صف المادة من XLSX", payload);
    assert(payload.openingBatches.length === 2, "لم تتم قراءة الدفعتين من XLSX", payload);
    assert(payload.openingBatches.every((row) => row["رمز المادة"] === itemCode), "رموز الدفعات غير متطابقة");
    console.log("✅ فتح وقراءة ملف XLSX فعليًا عبر SheetJS (ورقتان، مادة واحدة، دفعتان)");

    const libreOfficeDir = join(dataDir, "libreoffice-roundtrip");
    await mkdir(libreOfficeDir);
    await run("libreoffice", [
      "--headless",
      "--convert-to",
      "xlsx",
      "--outdir",
      libreOfficeDir,
      workbookPath,
    ]);
    const libreOfficePayload = readWorkbook(join(libreOfficeDir, "inventory-acceptance.xlsx"));
    assert(
      libreOfficePayload.items.length === 1 && libreOfficePayload.openingBatches.length === 2,
      "لم يحافظ LibreOffice على أوراق ملف Excel وبياناته",
      libreOfficePayload,
    );
    console.log("✅ فتح وإعادة حفظ الملف عبر LibreOffice نجح مع الحفاظ على الورقتين والدفعتين");

    const preview = await client.request("/api/items/bulk-import/preview?mode=insert", {
      method: "POST",
      body: payload,
    });
    assert(preview.status === 200 && preview.payload.valid === true, "فشلت معاينة ملف الاستيراد", preview.payload);
    assert(preview.payload.summary.openingBatches === 2, "المعاينة لم تحسب الدفعتين", preview.payload.summary);
    console.log("✅ المعاينة: الملف صالح والدفعتان معروفتان");

    const imported = await client.request("/api/items/bulk-import?mode=insert", {
      method: "POST",
      body: payload,
    });
    assert(imported.status === 200, "فشل استيراد ملف القبول", imported.payload);
    assert(imported.payload.created === 1 && imported.payload.openingBatches === 2, "نتيجة الاستيراد غير صحيحة", imported.payload);

    const itemsAfterImport = (await client.request("/api/items?limit=5000")).payload.items;
    const item = itemsAfterImport.find((candidate) => candidate.code === itemCode);
    assert(item, "المادة المستوردة غير موجودة");
    assert(Number(item.currentStock) === 12, "الرصيد بعد استيراد الدفعتين غير صحيح", item);
    console.log("✅ الاستيراد: مادة واحدة ودفعتان ورصيد افتتاحي 12");

    const exportedBeforeReplay = (await client.request("/api/items/export")).payload;
    assert(
      exportedBeforeReplay.openingBatches.filter((batch) => batch.code === itemCode).length === 2,
      "التصدير لم يعرض الدفعتين قبل الصرف",
      exportedBeforeReplay,
    );

    const exportedSubset = {
      version: exportedBeforeReplay.version,
      items: exportedBeforeReplay.items.filter((candidate) => candidate.code === itemCode),
      openingBatches: exportedBeforeReplay.openingBatches.filter((batch) => batch.code === itemCode),
    };
    const exportRoundTripPath = join(dataDir, "inventory-export-roundtrip.xlsx");
    makeWorkbookFromExport(exportRoundTripPath, exportedSubset);
    const exportRoundTripPayload = readWorkbook(exportRoundTripPath);
    assert(
      exportRoundTripPayload.items.length === 1 &&
        exportRoundTripPayload.items[0]["الرمز"] === itemCode &&
        exportRoundTripPayload.openingBatches.length === 2 &&
        exportRoundTripPayload.openingBatches.every((row) => row["رمز المادة"] === itemCode),
      "فقدت دورة التصدير وإعادة فتح XLSX بيانات المادة أو الدفعات",
      exportRoundTripPayload,
    );
    const exportRoundTripPreview = await client.request("/api/items/bulk-import/preview?mode=upsert", {
      method: "POST",
      body: exportRoundTripPayload,
    });
    assert(
      exportRoundTripPreview.status === 200 &&
        exportRoundTripPreview.payload.valid === true &&
        exportRoundTripPreview.payload.summary.openingBatches === 0 &&
        exportRoundTripPreview.payload.openingBatchRows.every((row) =>
          row.warnings.some((warning) => warning.code === "DUPLICATE_EXISTING_BATCH"),
        ),
      "فشلت معاينة ملف التصدير المعاد رفعه",
      exportRoundTripPreview.payload,
    );
    const exportRoundTripImport = await client.request("/api/items/bulk-import?mode=upsert", {
      method: "POST",
      body: exportRoundTripPayload,
    });
    assert(
      exportRoundTripImport.status === 200 &&
        exportRoundTripImport.payload.created === 0 &&
        exportRoundTripImport.payload.updated === 1 &&
        exportRoundTripImport.payload.openingBatches === 0,
      "إعادة رفع التصدير لم تكن تعريفية أو أنشأت دفعات إضافية",
      exportRoundTripImport.payload,
    );
    const itemAfterExportRoundTrip = (await client.request("/api/items?limit=5000")).payload.items.find(
      (candidate) => candidate.code === itemCode,
    );
    assert(Number(itemAfterExportRoundTrip?.currentStock) === 12, "تغير الرصيد بعد دورة التصدير", itemAfterExportRoundTrip);
    console.log("✅ دورة التصدير: أُعيد فتح XLSX ورفعه بوضع upsert دون تغيير الرصيد أو تكرار الدفعات");

    const replayPreview = await client.request("/api/items/bulk-import/preview?mode=insert", {
      method: "POST",
      body: payload,
    });
    const replayErrors = replayPreview.payload.itemRows.flatMap((row) => row.errors.map((error) => error.code));
    assert(
      replayPreview.status === 200 &&
        replayPreview.payload.valid === false &&
        replayErrors.includes("DUPLICATE_CODE"),
      "إعادة الملف لم تُرفض كتكرار",
      replayPreview.payload,
    );
    const replay = await client.request("/api/items/bulk-import?mode=insert", {
      method: "POST",
      body: payload,
    });
    assert(replay.status === 422, "تنفيذ إعادة الملف لم يُرفض", replay.payload);
    const itemsAfterReplay = (await client.request("/api/items?limit=5000")).payload.items;
    assert(
      itemsAfterReplay.filter((candidate) => candidate.code === itemCode).length === 1,
      "إعادة الملف أنشأت مادة مكررة",
    );
    const exportedAfterReplay = (await client.request("/api/items/export")).payload;
    assert(
      exportedAfterReplay.openingBatches.filter((batch) => batch.code === itemCode).length === 2,
      "إعادة الملف أنشأت دفعة مكررة",
      exportedAfterReplay,
    );
    console.log("✅ التكرار: إعادة نفس الملف رُفضت دون مادة أو دفعة أو حركة إضافية");

    const fefoBefore = await client.request(`/api/items/fefo-preview?itemId=${item.id}&quantity=8`);
    assert(fefoBefore.status === 200 && fefoBefore.payload.canFulfill === true, "FEFO قبل الصرف غير قابل للتنفيذ", fefoBefore.payload);
    assert(
      JSON.stringify(fefoBefore.payload.allocations.map((allocation) => [allocation.batchNumber, allocation.quantity])) ===
        JSON.stringify([["ACC-EARLY", 5], ["ACC-LATE", 3]]),
      "ترتيب FEFO قبل الصرف غير صحيح",
      fefoBefore.payload.allocations,
    );
    console.log("✅ تعدد الدفعات: FEFO اختار الأقرب 5 ثم الأبعد 3");

    const recipients = (await client.request("/api/recipients")).payload;
    const exitReasons = (await client.request("/api/exit-reasons")).payload;
    assert(recipients?.[0]?.id && exitReasons?.[0]?.id, "بيانات الجهة أو سبب الإخراج غير مزروعة");
    const outbound = await client.request("/api/transactions/out", {
      method: "POST",
      body: {
        itemType: "item",
        itemId: item.id,
        quantity: 6,
        recipientId: recipients[0].id,
        exitReasonId: exitReasons[0].id,
        internalDeliveryNoteNumber: `ACC-OUT-${itemCode}`,
        internalDeliveryNoteDate: "2026-09-10",
        deliveryDestination: "health_facility",
      },
    });
    assert(outbound.status === 201, "فشل الصرف الجزئي", outbound.payload);

    const fefoAfter = await client.request(`/api/items/fefo-preview?itemId=${item.id}&quantity=6`);
    assert(fefoAfter.status === 200 && fefoAfter.payload.canFulfill === true, "FEFO بعد الصرف غير قابل للتنفيذ", fefoAfter.payload);
    assert(
      JSON.stringify(fefoAfter.payload.allocations.map((allocation) => [allocation.batchNumber, allocation.quantity])) ===
        JSON.stringify([["ACC-LATE", 6]]),
      "الصرف الجزئي لم يستهلك الدفعة الأقرب أولًا",
      fefoAfter.payload.allocations,
    );
    const itemAfterOutbound = (await client.request("/api/items?limit=5000")).payload.items.find(
      (candidate) => candidate.code === itemCode,
    );
    assert(Number(itemAfterOutbound?.currentStock) === 6, "الرصيد بعد الصرف الجزئي غير صحيح", itemAfterOutbound);
    console.log("✅ الصرف الجزئي: استُهلكت الدفعة الأقرب أولًا وبقي الرصيد 6");

    console.log("\n═══ INVENTORY ACCEPTANCE: PASSED ═══");
  } finally {
    await stopApi(api);
    await rm(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\n❌ INVENTORY ACCEPTANCE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});