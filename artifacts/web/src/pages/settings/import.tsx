import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { useGetCurrentUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import {
  Settings2,
  KeyRound,
  Building2,
  Save,
  User as UserIcon,
  DatabaseBackup,
  Download,
  Ruler,
  Plus,
  X,
  CheckCircle2,
  Tag,
  Pencil,
  Trash2,
  FileSpreadsheet,
  Upload,
  Loader2,
  Activity,
  LogIn,
  LogOut as LogOutIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  ShieldCheck,
  Eye,
  EyeOff,
  UsersRound,
  ListChecks,
  Power,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/file-download';
import {
  INVENTORY_SHEET_NAMES,
  INVENTORY_TEMPLATE_COLUMNS,
  INVENTORY_TEMPLATE_VERSION,
  DEFAULT_INVENTORY_UNITS,
} from '@workspace/api-zod';
interface SystemSettings {
  id: number;
  orgName: string;
  orgSubtitle?: string | null;
  expiryAlertDays: number;
  unitsList?: string | null;
  technicalConditions?: string | null;
  returnConditions?: string | null;
  setupCompleted: boolean;
  updatedAt: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchSettings(): Promise<SystemSettings> {
  const res = await fetch('/api/settings', { credentials: 'include' });
  if (!res.ok) throw new Error('فشل جلب الإعدادات');
  return res.json() as Promise<SystemSettings>;
}

async function saveSettings(
  data: Partial<Pick<SystemSettings, 'orgName' | 'orgSubtitle' | 'expiryAlertDays' | 'unitsList' | 'technicalConditions' | 'returnConditions'>>,
): Promise<SystemSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'فشل حفظ الإعدادات');
  }
  return res.json() as Promise<SystemSettings>;
}

async function changePassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const res = await fetch('/api/settings/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'فشل تغيير كلمة المرور');
  }
}

const DEFAULT_TECHNICAL_CONDITIONS = [
  { key: 'good', label: 'جيد' },
  { key: 'needs_inspection', label: 'يحتاج فحص' },
  { key: 'maintenance', label: 'تحت الصيانة' },
  { key: 'broken', label: 'معطل' },
  { key: 'consumed', label: 'مستهلك / متلف' },
];

const DEFAULT_RETURN_CONDITIONS = [
  { key: 'good', label: 'جيد', behavior: 'good' },
  { key: 'damaged', label: 'تالف', behavior: 'damaged' },
  { key: 'needs_maintenance', label: 'يحتاج صيانة', behavior: 'needs_maintenance' },
  { key: 'missing', label: 'مفقود', behavior: 'missing' },
];

// ─── Settings Page ────────────────────────────────────────────────────────────

export function ImportTab() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [openingBatchRows, setOpeningBatchRows] = useState<ImportRow[]>([]);
  const [importPayload, setImportPayload] = useState<ImportPayload>({ items: [], openingBatches: [] });
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState('');
  const [importMode, setImportMode] = useState<'insert' | 'upsert'>('insert');
  const queryClient = useQueryClient();

  const { data: categoriesData } = useQuery<{ id: number; name: string; type: string }[]>({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await fetch('/api/categories', { credentials: 'include' });
      if (!res.ok) throw new Error('failed');
      return res.json() as Promise<{ id: number; name: string; type: string }[]>;
    },
  });

  const categories = categoriesData ?? [];

  const runPreview = async (payload: ImportPayload, mode: 'insert' | 'upsert') => {
    setPreviewing(true);
    try {
      const res = await fetch(`/api/items/bulk-import/preview?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ImportPreview & { error?: string };
      if (!res.ok && !data.summary) throw new Error(data.error || 'تعذر فحص الملف');
      setPreview(data);
      if (!data.valid && data.summary?.errorRows) {
        setParseError(`يوجد ${data.summary.errorRows} صف يحتاج إلى تصحيح قبل التنفيذ`);
      } else {
        setParseError('');
      }
    } catch (error) {
      setPreview(null);
      setParseError(error instanceof Error ? error.message : 'تعذر فحص الملف');
    } finally {
      setPreviewing(false);
    }
  };

  const patchTemplateArchive = (workbookBytes: Uint8Array) => {
    const archive = unzipSync(workbookBytes);
    const textStyleId = 1;
    const dateStyleId = 2;

    const patchStyles = () => {
      const path = 'xl/styles.xml';
      const styles = archive[path] ? strFromU8(archive[path]) : '';
      if (!styles || styles.includes('numFmtId="165"')) return;
      const numFmts = styles.match(/<numFmts count="(\d+)">/);
      const nextNumFmt = '<numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>';
      const withNumFmt = numFmts
        ? styles.replace(
            /(<numFmts count=")(\d+)(">)/,
            (_, prefix: string, count: string, suffix: string) =>
              `${prefix}${Number(count) + 1}${suffix}${nextNumFmt}`,
          )
        : styles.replace(
            '<fonts ',
            `<numFmts count="1">${nextNumFmt}</numFmts><fonts `,
          );
      const cellXfs = withNumFmt.match(/<cellXfs count="(\d+)">/);
      if (!cellXfs) return;
      const firstNewStyleId = Number(cellXfs[1]);
      const styleXml = [
        `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
        `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
      ].join('');
      archive[path] = strToU8(
        withNumFmt
          .replace(
            /(<cellXfs count=")(\d+)(">)/,
            (_, prefix: string, count: string, suffix: string) =>
              `${prefix}${Number(count) + 2}${suffix}`,
          )
          .replace('</cellXfs>', `${styleXml}</cellXfs>`)
          .replace(/__TEXT_STYLE__/g, String(firstNewStyleId))
          .replace(/__DATE_STYLE__/g, String(firstNewStyleId + 1)),
      );
    };

    const escapeXml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const patchSheet = (
      index: number,
      columnStyles: number[],
      validations: Array<{
        sqref: string;
        type: string;
        operator?: string;
        formula1: string;
        formula2?: string;
      }>,
    ) => {
      const path = `xl/worksheets/sheet${index}.xml`;
      if (!archive[path]) return;
      let xml = strFromU8(archive[path]);
      xml = xml.replace(
        /<sheetView workbookViewId="0"\/>/,
        '<sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>',
      );
      xml = xml.replace(
        /<col min="(\d+)" max="(\d+)"([^>]*)\/>/g,
        (match, min: string, _max: string, attrs: string) => {
          const style = columnStyles[Number(min) - 1];
          return style
            ? `<col min="${min}" max="${min}"${attrs.replace(/\sstyle="[^"]*"/, '')} style="${style}"/>`
            : match;
        },
      );
      if (validations.length && !xml.includes('<dataValidations')) {
        const validationXml = validations
          .map((validation) => {
            const attributes = [
              `type="${escapeXml(validation.type)}"`,
              validation.operator ? `operator="${escapeXml(validation.operator)}"` : '',
              `allowBlank="1"`,
              `showInputMessage="1"`,
              `showErrorMessage="1"`,
              `sqref="${escapeXml(validation.sqref)}"`,
            ].filter(Boolean).join(' ');
            const formulas = [
              `<formula1>${escapeXml(validation.formula1)}</formula1>`,
              validation.formula2 ? `<formula2>${escapeXml(validation.formula2)}</formula2>` : '',
            ].join('');
            return `<dataValidation ${attributes}>${formulas}</dataValidation>`;
          })
          .join('');
        const dataValidations = `<dataValidations count="${validations.length}">${validationXml}</dataValidations>`;
        xml = xml.includes('<ignoredErrors')
          ? xml.replace('<ignoredErrors', `${dataValidations}<ignoredErrors`)
          : xml.replace('</worksheet>', `${dataValidations}</worksheet>`);
      }
      archive[path] = strToU8(xml);
    };

    patchStyles();
    patchSheet(
      1,
      [textStyleId, textStyleId, textStyleId, textStyleId, 0, textStyleId, textStyleId],
      [
        { sqref: 'C2:C1000', type: 'list', formula1: `'${INVENTORY_SHEET_NAMES.referenceValues}'!$B$2:$B$100` },
        { sqref: 'D2:D1000', type: 'list', formula1: `'${INVENTORY_SHEET_NAMES.referenceValues}'!$A$2:$A$100` },
        { sqref: 'E2:E1000', type: 'whole', operator: 'greaterThanOrEqual', formula1: '0' },
      ],
    );
    patchSheet(
      2,
      [textStyleId, 0, textStyleId, dateStyleId, textStyleId, textStyleId, dateStyleId],
      [
        { sqref: 'A2:A1000', type: 'textLength', operator: 'greaterThan', formula1: '0' },
        { sqref: 'B2:B1000', type: 'whole', operator: 'greaterThanOrEqual', formula1: '0' },
        { sqref: 'D2:D1000', type: 'date', operator: 'between', formula1: 'DATE(1900,1,1)', formula2: 'DATE(9999,12,31)' },
        { sqref: 'G2:G1000', type: 'date', operator: 'between', formula1: 'DATE(1900,1,1)', formula2: 'DATE(9999,12,31)' },
      ],
    );
    patchSheet(3, [textStyleId, textStyleId, textStyleId], []);
    patchSheet(4, [textStyleId, textStyleId], []);
    return zipSync(archive);
  };

  const handleExportTemplate = async () => {
    const XLSX = await import('xlsx');
    const itemHeaders = INVENTORY_TEMPLATE_COLUMNS.items.map((column) => column.label);
    const batchHeaders = INVENTORY_TEMPLATE_COLUMNS.openingBatches.map((column) => column.label);
    const dataWs = XLSX.utils.aoa_to_sheet([itemHeaders]);
    const batchWs = XLSX.utils.aoa_to_sheet([batchHeaders]);
    const applySheetDefaults = (sheet: Record<string, unknown>, widths: number[], ref: string) => {
      sheet['!cols'] = widths.map((wch) => ({ wch }));
      sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
      sheet['!autofilter'] = { ref };
      sheet['!rightToLeft'] = true;
    };
    applySheetDefaults(dataWs, [14, 30, 14, 22, 16, 20, 30], 'A1:G1000');
    applySheetDefaults(batchWs, [16, 18, 16, 18, 22, 20, 20], 'A1:G1000');

    const instrRows = [
      [`نموذج استيراد المخزون — الإصدار ${INVENTORY_TEMPLATE_VERSION}`],
      [],
      ['الورقة', 'الاستخدام', 'ملاحظات'],
      [INVENTORY_SHEET_NAMES.items, 'تعريف المواد', 'اكتب مادة واحدة في كل صف. الاسم والوحدة مطلوبان.'],
      [INVENTORY_SHEET_NAMES.openingBatches, 'الأرصدة والدفعات الافتتاحية', 'استخدم رمز المادة. يمكن إضافة عدة دفعات للمادة نفسها.'],
      [INVENTORY_SHEET_NAMES.referenceValues, 'القيم المرجعية', 'لا تغيّر أسماء الأوراق أو الرؤوس.'],
      [],
      ['قواعد التعبئة'],
      ['الرمز', 'اكتبه كنص للحفاظ على الأصفار البادئة، مثل 0007.'],
      ['التاريخ', 'استخدم YYYY-MM-DD. يقبل المستورد أيضًا تاريخ Excel الرقمي.'],
      ['الكمية', 'عدد صحيح غير سالب. لا تستخدم رصيد المادة الموجودة لتغيير مخزونها.'],
      ['التصنيف والوحدة', 'استخدم القيم الموجودة في ورقة القيم المرجعية عندما تكون متاحة.'],
      ['الدفعات', 'استخدم ورقة الأرصدة والدفعات الافتتاحية لإضافة أكثر من دفعة للمادة نفسها.'],
      ['الرصيد الموجود', 'لا تغيّر رصيد مادة موجودة من ورقة المواد؛ استخدم حركة إدخال أو تسوية.'],
      ['التوافق', 'لا تغيّر أسماء الأوراق أو أسماء الرؤوس. تُقبل المرادفات العربية والقديمة عند الرفع.'],
      [],
      ['مثال تعبئة — للتوضيح فقط، وليس في ورقة البيانات'],
      ['MED-0007', 'شاش طبي معقم', 'رول', categories[0]?.name ?? '', 10, 'رف A3', ''],
      [],
      ['ملاحظة', 'صفوف ورقة البيانات تبدأ فارغة عمدًا. أدخل الدفعات الافتتاحية في ورقتها المستقلة.'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrRows);
    applySheetDefaults(instrWs, [32, 64, 56], 'A1:C30');

    const referenceValues = [
      ['التصنيفات', 'الوحدات'],
      ...Array.from({ length: Math.max(categories.length, DEFAULT_INVENTORY_UNITS.length) }, (_, index) => [
        categories[index]?.name ?? '',
        DEFAULT_INVENTORY_UNITS[index] ?? '',
      ]),
    ];
    const referenceWs = XLSX.utils.aoa_to_sheet(referenceValues);
    applySheetDefaults(referenceWs, [30, 20], 'A1:B100');
    (dataWs as Record<string, unknown>)['!dataValidation'] = [
      { sqref: 'D2:D1000', type: 'list', formula1: `'${INVENTORY_SHEET_NAMES.referenceValues}'!$A$2:$A$100` },
      { sqref: 'C2:C1000', type: 'list', formula1: `'${INVENTORY_SHEET_NAMES.referenceValues}'!$B$2:$B$100` },
      { sqref: 'E2:E1000', type: 'whole', operator: 'greaterThanOrEqual', formula1: '0' },
    ];
    (batchWs as Record<string, unknown>)['!dataValidation'] = [
      { sqref: 'A2:A1000', type: 'textLength', operator: 'greaterThan', formula1: '0' },
      { sqref: 'B2:B1000', type: 'whole', operator: 'greaterThanOrEqual', formula1: '0' },
      { sqref: 'D2:D1000', type: 'date', operator: 'between', formula1: 'DATE(1900,1,1)', formula2: 'DATE(9999,12,31)' },
      { sqref: 'G2:G1000', type: 'date', operator: 'between', formula1: 'DATE(1900,1,1)', formula2: 'DATE(9999,12,31)' },
    ];

    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: `نموذج استيراد المخزون ${INVENTORY_TEMPLATE_VERSION}`,
      Subject: 'المواد والأرصدة والدفعات الافتتاحية',
      Comments: `إصدار النموذج: ${INVENTORY_TEMPLATE_VERSION}`,
    };
    XLSX.utils.book_append_sheet(wb, dataWs, INVENTORY_SHEET_NAMES.items);
    XLSX.utils.book_append_sheet(wb, batchWs, INVENTORY_SHEET_NAMES.openingBatches);
    XLSX.utils.book_append_sheet(wb, instrWs, INVENTORY_SHEET_NAMES.instructions);
    XLSX.utils.book_append_sheet(wb, referenceWs, INVENTORY_SHEET_NAMES.referenceValues);
    const workbookBytes = patchTemplateArchive(
      new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })),
    );
    await downloadFile(
      new Blob([workbookBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'نموذج_استيراد_المواد.xlsx',
    );
    toast.success('تم تحميل النموذج بنجاح');
  };

  const handleExportInventory = async () => {
    try {
      const res = await fetch('/api/items/export', { credentials: 'include' });
      const data = (await res.json()) as {
        version: string;
        items: Record<string, unknown>[];
        openingBatches: Record<string, unknown>[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'تعذر تصدير المخزون');
      const XLSX = await import('xlsx');
      const itemHeaders = INVENTORY_TEMPLATE_COLUMNS.items.map((column) => column.label);
      const batchHeaders = INVENTORY_TEMPLATE_COLUMNS.openingBatches.map((column) => column.label);
      const itemRows = data.items.map((row) =>
        INVENTORY_TEMPLATE_COLUMNS.items.map((column) => row[column.key] ?? ''),
      );
      const batchRows = data.openingBatches.map((row) =>
        INVENTORY_TEMPLATE_COLUMNS.openingBatches.map((column) => row[column.key] ?? ''),
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([itemHeaders, ...itemRows]),
        INVENTORY_SHEET_NAMES.items,
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([batchHeaders, ...batchRows]),
        INVENTORY_SHEET_NAMES.openingBatches,
      );
      const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      await downloadFile(
        new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `تصدير_المخزون_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`تم تصدير ${data.items.length} مادة و${data.openingBatches.length} دفعة`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تصدير المخزون');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setResult(null);
    setPreview(null);
    setFileName(file.name);
    setRows([]);
    setOpeningBatchRows([]);

    try {
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('حجم الملف يتجاوز الحد المسموح به (10 ميغابايت)');
      }
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });

      // Prefer the standardized materials sheet; legacy "البيانات" remains supported.
      const sheetName = wb.SheetNames.includes(INVENTORY_SHEET_NAMES.items)
        ? INVENTORY_SHEET_NAMES.items
        : wb.SheetNames.includes('البيانات')
          ? 'البيانات'
        : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const data = ws ? XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: '' }) : [];
      const batchSheet = wb.SheetNames.includes(INVENTORY_SHEET_NAMES.openingBatches)
        ? wb.Sheets[INVENTORY_SHEET_NAMES.openingBatches]
        : undefined;
      const batches = batchSheet
        ? XLSX.utils.sheet_to_json<ImportRow>(batchSheet, { defval: '' })
        : [];

      if (data.length === 0 && batches.length === 0) {
        setParseError(`لم يتم العثور على بيانات — املأ ورقة "${INVENTORY_SHEET_NAMES.items}" ثم أعد الرفع`);
        return;
      }
      setRows(data);
      setOpeningBatchRows(batches);
      const payload = { items: data, openingBatches: batches };
      setImportPayload(payload);
      await runPreview(payload, importMode);
    } catch {
      setParseError('فشل قراءة الملف أو تجاوزه الحدود — تأكد أنه ملف Excel صالح (.xlsx أو .xls)');
    }
    e.target.value = '';
  };

  const getName = (r: ImportRow) =>
    String(r['الاسم *'] ?? r['الاسم'] ?? '').trim();
  const getUnit = (r: ImportRow) =>
    String(r['الوحدة *'] ?? r['الوحدة'] ?? '').trim();

  const handleImport = async () => {
    if (importPayload.items.length === 0 && importPayload.openingBatches.length === 0) return;
    if (!preview?.valid) {
      toast.error('صحح أخطاء المعاينة قبل التنفيذ');
      return;
    }
    setImporting(true);
    setResult(null);

    try {
      const res = await fetch(`/api/items/bulk-import?mode=${importMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(importPayload),
      });
      const data = (await res.json()) as ImportResult & ImportPreview;
      if (data.summary) setPreview(data);
      if (!res.ok) throw new Error(data.error || 'تعذر تنفيذ الاستيراد');
      setResult(data);
      const total = data.created + (data.updated ?? 0);
      if (total > 0) {
        const parts: string[] = [];
        if (data.created > 0) parts.push(`إضافة ${data.created}`);
        if ((data.updated ?? 0) > 0) parts.push(`تحديث ${data.updated}`);
        toast.success(`تم ${parts.join(' و')} مادة بنجاح`);
        void queryClient.invalidateQueries({ queryKey: ['items'] });
        setRows([]);
        setOpeningBatchRows([]);
        setImportPayload({ items: [], openingBatches: [] });
        setPreview(null);
        setFileName('');
      } else {
        toast.error('لم يتم استيراد أي مادة — راجع الأخطاء أدناه');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حدث خطأ أثناء الاستيراد');
    } finally {
      setImporting(false);
    }
  };

  const previewCols: { label: string; get: (r: ImportRow) => string }[] = [
    { label: 'الاسم', get: (r) => getName(r) || '—' },
    { label: 'الوحدة', get: (r) => getUnit(r) || '—' },
    { label: 'التصنيف', get: (r) => String(r['التصنيف'] ?? '') || '—' },
    { label: 'الكمية', get: (r) => String(r['الكمية الحالية'] ?? 0) },
    { label: 'الحد الأدنى', get: (r) => String(r['الحد الأدنى'] ?? 0) },
  ];
  const totalPayloadRows = importPayload.items.length + importPayload.openingBatches.length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">استيراد المواد من Excel</h3>
        <p className="text-sm text-muted-foreground mt-1">
          حمّل النموذج الفارغ، أدخل بيانات المواد، ثم استوردها للنظام دفعةً واحدة.
        </p>
      </div>

      {/* Step 1 — Download template */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">١</span>
          <span className="font-medium text-sm">حمّل النموذج الفارغ</span>
        </div>
        <p className="text-xs text-muted-foreground">
          ملف Excel جاهز بأعمدة المواد وورقة تعليمات مفصّلة.
          الحقلان المطلوبان هما <strong>الاسم</strong> و<strong>الوحدة</strong> فقط.
        </p>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void handleExportTemplate()}>
          <Download className="h-4 w-4" />
          تحميل نموذج Excel
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void handleExportInventory()}>
          <ArrowDownToLine className="h-4 w-4" />
          تصدير المخزون لإعادة الاستيراد
        </Button>
      </div>

      {/* Step 2 — Upload file */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">٢</span>
          <span className="font-medium text-sm">ارفع الملف المعبأ</span>
        </div>
        <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
          <div className="flex flex-col items-center gap-1 pointer-events-none">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {fileName ? fileName : 'اضغط لاختيار ملف Excel'}
            </span>
            {!fileName && <span className="text-xs text-muted-foreground">.xlsx أو .xls</span>}
          </div>
          <input
            type="file"
            className="hidden"
            accept=".xlsx,.xls"
            onChange={(e) => void handleFileChange(e)}
          />
        </label>
        {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        {totalPayloadRows > 0 && (
          <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            تم قراءة <strong>{totalPayloadRows}</strong> صف
            {openingBatchRows.length > 0 && ` (${rows.length} مواد و${openingBatchRows.length} دفعات)`}
          </p>
        )}
      </div>

      {/* Preview table */}
      {preview && (
        <div className="rounded-lg border overflow-hidden">
          <div className="px-3 py-3 border-b bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">فحص ومعاينة كامل الملف</span>
              <Badge variant={preview.valid ? 'secondary' : 'destructive'}>
                {preview.valid ? 'جاهز للتنفيذ' : 'يحتاج تصحيح'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-6">
              <span>الصفوف: <strong>{preview.summary.totalRows}</strong></span>
              <span className="text-green-700">صالحة: <strong>{preview.summary.validRows}</strong></span>
              <span className="text-amber-700">تحذيرات: <strong>{preview.summary.warningRows}</strong></span>
              <span className="text-destructive">أخطاء: <strong>{preview.summary.errorRows}</strong></span>
              <span>مواد جديدة: <strong>{preview.summary.newItems}</strong></span>
              <span>دفعات: <strong>{preview.summary.openingBatches}</strong></span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/20">
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">الصف</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">الحالة</th>
                  {previewCols.map((c) => (
                    <th key={c.label} className="px-3 py-2 text-right font-medium text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.itemRows.map((decision) => (
                  <tr key={`item-${decision.rowNumber}`} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2">{decision.rowNumber}</td>
                    <td className={`px-3 py-2 font-medium ${decision.state === 'error' ? 'text-destructive' : decision.state === 'warning' ? 'text-amber-700' : 'text-green-700'}`}>
                      {decision.state === 'error' ? 'خطأ' : decision.state === 'warning' ? 'تحذير' : decision.state === 'empty' ? 'فارغ' : decision.action === 'update-item' ? 'تحديث' : 'إضافة'}
                      {decision.errors.length > 0 && <div>{decision.errors.map((issue) => issue.message).join('؛ ')}</div>}
                    </td>
                    {previewCols.map((c) => (
                      <td key={c.label} className="px-3 py-2">{c.get(decision.row as ImportRow)}</td>
                    ))}
                  </tr>
                ))}
                {preview.openingBatchRows.map((decision) => (
                  <tr key={`batch-${decision.rowNumber}`} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-3 py-2">{decision.rowNumber}</td>
                    <td className={`px-3 py-2 font-medium ${decision.state === 'error' ? 'text-destructive' : decision.state === 'warning' ? 'text-amber-700' : 'text-green-700'}`}>
                      دفعة {decision.state === 'error' ? '— خطأ' : decision.state === 'warning' ? '— تحذير' : '— جاهزة'}
                      {decision.errors.length > 0 && <div>{decision.errors.map((issue) => issue.message).join('؛ ')}</div>}
                    </td>
                    <td className="px-3 py-2">{String(decision.row.code ?? '—')}</td>
                    <td className="px-3 py-2">{String(decision.row.quantity ?? '—')}</td>
                    <td className="px-3 py-2">{String(decision.row.batchNumber ?? '—')}</td>
                    <td className="px-3 py-2">{String(decision.row.expiryDate ?? '—')}</td>
                    <td className="px-3 py-2">{String(decision.row.supplier ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3 — Mode + Import */}
      {totalPayloadRows > 0 && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">٣</span>
            <span className="font-medium text-sm">اختر الوضع وابدأ الاستيراد</span>
          </div>

          {/* Mode toggle */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">وضع الاستيراد</p>
            <div className="inline-flex rounded-lg border bg-muted p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setImportMode('insert');
                  void runPreview(importPayload, 'insert');
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  importMode === 'insert'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                إضافة فقط
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportMode('upsert');
                  void runPreview(importPayload, 'upsert');
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  importMode === 'upsert'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                تحديث وإضافة
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {importMode === 'insert'
                ? 'المواد بنفس الرمز ستُرفض — مناسب للاستيراد الأوّلي.'
                : 'المواد بنفس الرمز ستُحدَّث بالكامل — المواد الجديدة ستُضاف تلقائياً.'}
            </p>
          </div>

          <Button onClick={() => void handleImport()} disabled={importing || previewing || !preview?.valid} className="gap-2">
            {importing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileSpreadsheet className="h-4 w-4" />}
            {previewing ? 'جارٍ فحص الملف…' : importing ? 'جارٍ الاستيراد…' : `${importMode === 'upsert' ? 'تحديث/إضافة' : 'استيراد'} ${totalPayloadRows} صف`}
          </Button>
        </div>
      )}

      {/* Results */}
      {result && (() => {
        const total = result.created + (result.updated ?? 0);
        const hasSuccess = total > 0;
        const summaryParts: string[] = [];
        if (result.created > 0) summaryParts.push(`إضافة ${result.created} مادة`);
        if ((result.updated ?? 0) > 0) summaryParts.push(`تحديث ${result.updated} مادة`);
        return (
          <div className={`rounded-lg border p-4 space-y-2 ${
            hasSuccess
              ? 'border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900'
              : 'border-destructive/30 bg-destructive/5'
          }`}>
            <div className="flex items-center gap-2">
              {hasSuccess
                ? <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                : <X className="h-5 w-5 text-destructive" />}
              <span className="font-medium text-sm">
                {hasSuccess
                  ? `تم ${summaryParts.join(' و')} بنجاح`
                  : 'لم يتم استيراد أي مادة'}
              </span>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  الأخطاء ({result.errors.length} صف):
                </p>
                <div className="max-h-36 overflow-y-auto space-y-0.5 rounded border bg-background p-2">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">
                      صف {e.row}: <span className="font-medium">{e.name}</span> — {e.error}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Equipment Import Tab ────────────────────────────────────────────────────

const CONDITION_LABELS: Record<string, string> = {
  good: 'جيدة',
  maintenance: 'في الصيانة',
  broken: 'معطلة',
  consumed: 'مستهلكة',
  needs_inspection: 'تحتاج فحص',
};

export function ImportEquipmentTab() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState('');
  const [importMode, setImportMode] = useState<'insert' | 'upsert'>('insert');
  const queryClient = useQueryClient();

  const handleExportTemplate = async () => {
    const XLSX = await import('xlsx');

    // Sheet 1: Data headers
    const dataHeaders = [
      'الاسم *', 'نوع التجهيز', 'الموديل', 'الرقم التسلسلي',
      'الحالة', 'الكمية', 'الحد الأدنى للكمية',
      'سنة الصنع', 'بلد المنشأ', 'الحائز الحالي', 'ملاحظات',
    ];
    const dataWs = XLSX.utils.aoa_to_sheet([dataHeaders]);
    dataWs['!cols'] = [
      { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 22 },
      { wch: 18 }, { wch: 12 }, { wch: 20 },
      { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 30 },
    ];

    // Sheet 2: Instructions
    const conditionOptions = Object.entries(CONDITION_LABELS)
      .map(([, ar]) => ar)
      .join(' — ');
    const instrRows = [
      ['تعليمات الاستخدام — نموذج استيراد التجهيزات'],
      [],
      ['العمود', 'الوصف', 'مطلوب؟', 'ملاحظات'],
      ['الاسم *', 'اسم التجهيز أو الجهاز', 'نعم', ''],
      ['نوع التجهيز', 'تصنيف التجهيز (مثال: جهاز طبي، أثاث)', 'لا', ''],
      ['الموديل', 'رقم الموديل أو الطراز', 'لا', ''],
      ['الرقم التسلسلي', 'الرقم التسلسلي الفريد للجهاز', 'لا', 'يجب أن يكون فريداً إذا أُدخل'],
      ['الحالة', 'حالة التجهيز', 'لا', `القيم المقبولة: ${conditionOptions} — أو: good, maintenance, broken, consumed, needs_inspection — افتراضي: جيدة`],
      ['الكمية', 'عدد القطع المتوفرة', 'لا', 'رقم صحيح ≥ 1 — افتراضي: 1'],
      ['الحد الأدنى للكمية', 'الحد الأدنى لإطلاق تنبيه النقص', 'لا', 'رقم صحيح ≥ 0 — افتراضي: 0 (لا تنبيه)'],
      ['سنة الصنع', 'السنة الميلادية للتصنيع', 'لا', 'رقم بين 1900 و2100'],
      ['بلد المنشأ', 'بلد التصنيع', 'لا', ''],
      ['الحائز الحالي', 'اسم القسم أو الشخص المسؤول', 'لا', ''],
      ['ملاحظات', 'أي ملاحظات إضافية', 'لا', ''],
      [],
      ['مثال على صف بيانات:'],
      ['جهاز قياس ضغط الدم الرقمي', 'جهاز طبي', 'BPM-2000', 'SN-2024-001', 'جيدة', 3, 2, 2022, 'ألمانيا', 'قسم التجهيزات', 'شاشة LCD'],
    ];
    const instrWs = XLSX.utils.aoa_to_sheet(instrRows);
    instrWs['!cols'] = [
      { wch: 22 }, { wch: 36 }, { wch: 10 }, { wch: 65 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, dataWs, 'البيانات');
    XLSX.utils.book_append_sheet(wb, instrWs, 'التعليمات');
    const workbookBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await downloadFile(
      new Blob([workbookBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'نموذج_استيراد_التجهيزات.xlsx',
    );
    toast.success('تم تحميل النموذج بنجاح');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError('');
    setResult(null);
    setFileName(file.name);
    setRows([]);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
      const sheetName = wb.SheetNames.includes('البيانات')
        ? 'البيانات'
        : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: '' });

      if (data.length === 0) {
        setParseError('لم يتم العثور على بيانات في الملف — تأكد من تعبئة ورقة "البيانات"');
        return;
      }
      setRows(data);
    } catch {
      setParseError('فشل قراءة الملف — تأكد أنه ملف Excel صالح (.xlsx أو .xls)');
    }
    e.target.value = '';
  };

  const getName = (r: ImportRow) =>
    String(r['الاسم *'] ?? r['الاسم'] ?? '').trim();

  const handleImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResult(null);

    const payload = rows.map((r) => ({
      name: getName(r),
      equipmentType: String(r['نوع التجهيز'] ?? '').trim() || null,
      model: String(r['الموديل'] ?? '').trim() || null,
      serialNumber: String(r['الرقم التسلسلي'] ?? '').trim() || null,
      condition: String(r['الحالة'] ?? '').trim() || null,
      quantity: r['الكمية'] ? Number(r['الكمية']) : 1,
      minQuantity: r['الحد الأدنى للكمية'] ? Number(r['الحد الأدنى للكمية']) : 0,
      manufactureYear: r['سنة الصنع'] ? Number(r['سنة الصنع']) : null,
      originCountry: String(r['بلد المنشأ'] ?? '').trim() || null,
      currentHolder: String(r['الحائز الحالي'] ?? '').trim() || null,
      notes: String(r['ملاحظات'] ?? '').trim() || null,
    }));

    try {
      const res = await fetch(`/api/equipment/bulk-import?mode=${importMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ImportResult;
      setResult(data);
      const total = data.created + (data.updated ?? 0);
      if (total > 0) {
        const parts: string[] = [];
        if (data.created > 0) parts.push(`إضافة ${data.created}`);
        if ((data.updated ?? 0) > 0) parts.push(`تحديث ${data.updated}`);
        toast.success(`تم ${parts.join(' و')} تجهيز بنجاح`);
        void queryClient.invalidateQueries({ queryKey: ['equipment'] });
        setRows([]);
        setFileName('');
      } else {
        toast.error('لم يتم استيراد أي تجهيز — راجع الأخطاء أدناه');
      }
    } catch {
      toast.error('حدث خطأ أثناء الاستيراد');
    } finally {
      setImporting(false);
    }
  };

  const previewCols: { label: string; get: (r: ImportRow) => string }[] = [
    { label: 'الاسم', get: (r) => getName(r) || '—' },
    { label: 'نوع التجهيز', get: (r) => String(r['نوع التجهيز'] ?? '') || '—' },
    { label: 'الموديل', get: (r) => String(r['الموديل'] ?? '') || '—' },
    { label: 'الحالة', get: (r) => String(r['الحالة'] ?? '') || '—' },
    { label: 'الرقم التسلسلي', get: (r) => String(r['الرقم التسلسلي'] ?? '') || '—' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">استيراد التجهيزات من Excel</h3>
        <p className="text-sm text-muted-foreground mt-1">
          حمّل النموذج الفارغ، أدخل بيانات التجهيزات، ثم استوردها للنظام دفعةً واحدة.
        </p>
      </div>

      {/* Step 1 — Download template */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">١</span>
          <span className="font-medium text-sm">حمّل النموذج الفارغ</span>
        </div>
        <p className="text-xs text-muted-foreground">
          ملف Excel جاهز بأعمدة التجهيزات وورقة تعليمات مفصّلة.
          الحقل الوحيد المطلوب هو <strong>الاسم</strong>.
        </p>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void handleExportTemplate()}>
          <Download className="h-4 w-4" />
          تحميل نموذج Excel
        </Button>
      </div>

      {/* Step 2 — Upload file */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">٢</span>
          <span className="font-medium text-sm">ارفع الملف المعبأ</span>
        </div>
        <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
          <div className="flex flex-col items-center gap-1 pointer-events-none">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {fileName ? fileName : 'اضغط لاختيار ملف Excel'}
            </span>
            {!fileName && <span className="text-xs text-muted-foreground">.xlsx أو .xls</span>}
          </div>
          <input
            type="file"
            className="hidden"
            accept=".xlsx,.xls"
            onChange={(e) => void handleFileChange(e)}
          />
        </label>
        {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        {rows.length > 0 && (
          <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            تم قراءة <strong>{rows.length}</strong> صف من الملف
          </p>
        )}
      </div>

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
            <span className="text-sm font-medium">معاينة البيانات</span>
            <span className="text-xs text-muted-foreground">
              {rows.length > 5 ? `أول 5 صفوف من ${rows.length}` : `${rows.length} صف`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/20">
                  {previewCols.map((c) => (
                    <th key={c.label} className="px-3 py-2 text-right font-medium text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/10">
                    {previewCols.map((c) => (
                      <td key={c.label} className="px-3 py-2">{c.get(r)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3 — Mode + Import */}
      {rows.length > 0 && (
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">٣</span>
            <span className="font-medium text-sm">اختر الوضع وابدأ الاستيراد</span>
          </div>

          {/* Mode toggle */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">وضع الاستيراد</p>
            <div className="inline-flex rounded-lg border bg-muted p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setImportMode('insert')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  importMode === 'insert'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                إضافة فقط
              </button>
              <button
                type="button"
                onClick={() => setImportMode('upsert')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  importMode === 'upsert'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                تحديث وإضافة
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {importMode === 'insert'
                ? 'التجهيزات بنفس الرقم التسلسلي ستُرفض — مناسب للاستيراد الأوّلي.'
                : 'التجهيزات بنفس الرقم التسلسلي ستُحدَّث بالكامل — الجديدة ستُضاف تلقائياً.'}
            </p>
          </div>

          <Button onClick={() => void handleImport()} disabled={importing} className="gap-2">
            {importing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <FileSpreadsheet className="h-4 w-4" />}
            {importing ? 'جارٍ الاستيراد…' : `${importMode === 'upsert' ? 'تحديث/إضافة' : 'استيراد'} ${rows.length} تجهيز`}
          </Button>
        </div>
      )}

      {/* Results */}
      {result && (() => {
        const total = result.created + (result.updated ?? 0);
        const hasSuccess = total > 0;
        const summaryParts: string[] = [];
        if (result.created > 0) summaryParts.push(`إضافة ${result.created} تجهيز`);
        if ((result.updated ?? 0) > 0) summaryParts.push(`تحديث ${result.updated} تجهيز`);
        return (
          <div className={`rounded-lg border p-4 space-y-2 ${
            hasSuccess
              ? 'border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900'
              : 'border-destructive/30 bg-destructive/5'
          }`}>
            <div className="flex items-center gap-2">
              {hasSuccess
                ? <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                : <X className="h-5 w-5 text-destructive" />}
              <span className="font-medium text-sm">
                {hasSuccess
                  ? `تم ${summaryParts.join(' و')} بنجاح`
                  : 'لم يتم استيراد أي تجهيز'}
              </span>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  الأخطاء ({result.errors.length} صف):
                </p>
                <div className="max-h-36 overflow-y-auto space-y-0.5 rounded border bg-background p-2">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive">
                      صف {e.row}: <span className="font-medium">{e.name}</span> — {e.error}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

interface ImportRow {
  [key: string]: unknown;
}

interface ImportResult {
  created: number;
  updated?: number;
  openingBatches?: number;
  errors: { row: number; name: string; error: string }[];
  warnings?: { row: number; name: string; warning: string }[];
}

interface ImportPreview {
  valid: boolean;
  error?: string;
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    newItems: number;
    updatedItems: number;
    openingBatches: number;
  };
  itemRows: ImportPreviewRow[];
  openingBatchRows: ImportPreviewRow[];
}

interface ImportPayload {
  items: ImportRow[];
  openingBatches: ImportRow[];
}

interface ImportPreviewRow {
  rowNumber: number;
  state: 'valid' | 'warning' | 'error' | 'empty';
  action: string;
  row: Record<string, unknown>;
  errors: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
}


