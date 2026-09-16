import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';

type Issue = { sheet: 'items' | 'equipment'; row: number; field?: string; code: string; message: string; severity: 'error' | 'warning' };
type Decision = { row: number; action: 'create' | 'update' | 'skip' | 'error'; key: string; issues: Issue[] };
type Preview = {
  mode: string;
  summary: { items: Record<string, number>; equipment: Record<string, number>; totals: Record<string, number> };
  items: Decision[];
  equipment: Decision[];
};

const ITEM_HEADERS = ['الرمز', 'الاسم', 'التصنيف', 'الوحدة', 'الحد الأدنى', 'يتطلب دفعة', 'يتطلب صلاحية', 'الموقع', 'المورد', 'ملاحظات', 'فعّال'];
const EQUIPMENT_HEADERS = ['الرمز', 'الاسم', 'النوع', 'الشركة', 'الموديل', 'الرقم التسلسلي', 'الوحدة', 'الحد الأدنى', 'يتطلب رقم تسلسلي', 'ملاحظات', 'فعّال'];

const ACTION_LABEL: Record<Decision['action'], string> = {
  create: 'إضافة', update: 'تحديث', skip: 'تخطٍّ', error: 'خطأ',
};

/**
 * Catalog import panel (materials + equipment definitions).
 *
 * The template carries definitions only - never quantities. Preview runs on the
 * server and never writes; the commit is atomic and admin-only.
 */
export function CatalogImportPanel({
  knownUnits,
  knownCategories,
  onDone,
}: {
  knownUnits: string[];
  knownCategories: string[];
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<'add-only' | 'add-and-update'>('add-and-update');
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ items: Array<Record<string, unknown>>; equipment: Array<Record<string, unknown>> } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function downloadTemplate() {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ITEM_HEADERS]), 'المواد');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([EQUIPMENT_HEADERS]), 'التجهيزات');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['الوحدات المعتمدة', ...knownUnits],
        ['التصنيفات المعتمدة', ...knownCategories],
      ]), 'القيم المرجعية');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['قالب الكتالوج — تعريفات المواد والتجهيزات فقط'],
        ['لا تضف أي أعمدة كمية؛ الأرصدة تُدار بالحركات (إدخال/إخراج/تحويل).'],
        ['الوحدة والتصنيف يجب أن يكونا من ورقة «القيم المرجعية» كما هي.'],
      ]), 'التعليمات');
      const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `قالب-الكتالوج-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('تعذّر إنشاء القالب.');
    }
  }

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setMessage(null);
    setPreview(null);
    setPayload(null);
    try {
      const XLSX = await import('xlsx');
      const isCsv = /\.csv$/i.test(file.name);
      let items: Array<Record<string, unknown>> = [];
      let equipment: Array<Record<string, unknown>> = [];
      if (isCsv) {
        // CSV carries a single sheet: the first row is the header row (same Arabic labels).
        const csvText = await file.text();
        const parsed = XLSX.read(csvText, { type: 'string' });
        const first = parsed.SheetNames[0];
        items = first
          ? (XLSX.utils.sheet_to_json(parsed.Sheets[first], { defval: '' }) as Array<Record<string, unknown>>)
          : [];
        setCsvNote('ملف CSV: يُقرأ كجدول مواد واحد (ورقة التجهيزات غير متاحة في CSV).');
      } else {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheetRows = (name: string) => {
          const sheet = wb.Sheets[name];
          return sheet ? (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Array<Record<string, unknown>>) : [];
        };
        items = sheetRows('المواد');
        equipment = sheetRows('التجهيزات');
        setCsvNote(null);
      }
      if (items.length === 0 && equipment.length === 0) {
        setError('لم يُعثر على صفوف في ورقتي «المواد» أو «التجهيزات».');
        return;
      }
      setFileName(file.name);
      const body = { mode, items, equipment };
      setPayload({ items, equipment });
      const res = await fetch('/api/catalog/import/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? 'تعذّر تحليل الملف');
      setPreview(data as Preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ في قراءة الملف');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!payload) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/catalog/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? 'تعذّر التنفيذ');
      const d = data as { createdItems: number; updatedItems: number; createdEquipment: number; updatedEquipment: number; skipped: number };
      setMessage(`تم الاستيراد: مواد جديدة ${d.createdItems} · مواد محدَّثة ${d.updatedItems} · تجهيزات جديدة ${d.createdEquipment} · تجهيزات محدَّثة ${d.updatedEquipment} · مُتخطّى ${d.skipped}.`);
      setPreview(null);
      setPayload(null);
      setFileName(null);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setBusy(false);
    }
  }

  function downloadIssues() {
    if (!preview) return;
    const rows = [['الورقة', 'السطر', 'الحقل', 'الرمز', 'الرسالة']];
    for (const decision of [...preview.items, ...preview.equipment]) {
      for (const issue of decision.issues) {
        rows.push([issue.sheet === 'items' ? 'المواد' : 'التجهيزات', String(issue.row), issue.field ?? '', issue.code, issue.message]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `أخطاء-استيراد-الكتالوج-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totals = preview?.summary?.totals;
  const issues = preview ? [...preview.items, ...preview.equipment].filter((d) => d.issues.length > 0) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" aria-hidden="true" /> استيراد الكتالوج من Excel
          </CardTitle>
          <CardDescription>
            قالب التعريفات (مواد + تجهيزات) — بلا أي أعمدة كمية. المعاينة لا تكتب شيئًا، والتنفيذ ذرّي وللمدير فقط.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" className="gap-2" onClick={() => void downloadTemplate()}>
              <Download className="h-4 w-4" /> تنزيل قالب الكتالوج
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-mode">وضع الاستيراد</Label>
              <select
                id="catalog-mode"
                className="rounded-md border bg-background p-2 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'add-only' | 'add-and-update')}
              >
                <option value="add-and-update">إضافة وتحديث</option>
                <option value="add-only">إضافة فقط</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-file">ملف Excel</Label>
              <input
                id="catalog-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                className="block text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </div>
          </div>

          {fileName && <p className="text-xs text-muted-foreground">الملف: {fileName}</p>}
          {csvNote && (
            <p className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs text-amber-800">{csvNote}</p>
          )}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
          {message && <p className="rounded-md border border-emerald-600/30 bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>معاينة الاستيراد</CardTitle>
              <CardDescription>
                إضافة {totals?.create ?? 0} · تحديث {totals?.update ?? 0} · تخطٍّ {totals?.skip ?? 0} · أخطاء {totals?.error ?? 0}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {issues.length > 0 && (
                <Button variant="outline" className="gap-2" onClick={downloadIssues}>
                  <Download className="h-4 w-4" /> تقرير الأخطاء
                </Button>
              )}
              <Button className="gap-2" onClick={() => void commit()} disabled={busy || (totals?.error ?? 0) > 0}>
                {totals?.error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} تنفيذ الاستيراد
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(totals?.error ?? 0) > 0 && (
              <p className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-sm text-amber-800">
                يوجد {totals?.error} سطرًا بأخطاء؛ صحّح الملف ثم أعد الرفع (لا يُسمح بتنفيذ جزئي).
              </p>
            )}
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا أخطاء في الملف. ✅</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الورقة</TableHead>
                    <TableHead>السطر</TableHead>
                    <TableHead>الحقل</TableHead>
                    <TableHead>الرسالة</TableHead>
                    <TableHead>الخطورة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.slice(0, 100).flatMap((d) =>
                    d.issues.map((issue, i) => (
                      <TableRow key={`${d.key}-${issue.row}-${i}`}>
                        <TableCell>{issue.sheet === 'items' ? 'المواد' : 'التجهيزات'}</TableCell>
                        <TableCell>{issue.row}</TableCell>
                        <TableCell>{issue.field ?? '—'}</TableCell>
                        <TableCell>{issue.message}</TableCell>
                        <TableCell>
                          {issue.severity === 'error' ? <Badge variant="destructive">خطأ</Badge> : <Badge variant="outline">تنبيه</Badge>}
                        </TableCell>
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            )}

            <div className="max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الإجراء</TableHead>
                    <TableHead>الورقة</TableHead>
                    <TableHead>السطر</TableHead>
                    <TableHead>المفتاح</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...preview.items.map((d) => ({ ...d, sheet: 'المواد' })), ...preview.equipment.map((d) => ({ ...d, sheet: 'التجهيزات' }))].map((d) => (
                    <TableRow key={`${d.sheet}-${d.row}`}>
                      <TableCell>
                        <Badge variant={d.action === 'error' ? 'destructive' : d.action === 'create' ? 'default' : 'outline'}>
                          {ACTION_LABEL[d.action]}
                        </Badge>
                      </TableCell>
                      <TableCell>{d.sheet}</TableCell>
                      <TableCell>{d.row}</TableCell>
                      <TableCell className="font-mono text-xs">{d.key}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">ملاحظات القالب</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>• الوحدة والتصنيف يجب أن يطابقا ورقة «القيم المرجعية» حرفيًا.</p>
          <p>• للتجهيزات: الرقم التسلسلي هو المفتاح الأساسي، والكمية تُثبَّت على 1.</p>
          <p>• لا توجد أعمدة كمية في قالب الكتالوج؛ رصيد الافتتاح يُدار من قالب الرصيد الافتتاحي أو الحركات.</p>
          <p>• يُقبل Excel (.xlsx/.xls) وCSV: في CSV يُقرأ جدول المواد بعناوينه العربية نفسها (بورقة واحدة).</p>
        </CardContent>
      </Card>
    </div>
  );
}
