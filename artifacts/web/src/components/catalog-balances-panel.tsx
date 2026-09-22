import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, Download, PackagePlus } from 'lucide-react';

type Issue = { code: string; message: string };
type BatchRow = {
  rowNumber: number;
  state: string;
  action: string;
  row: { warehouseCode?: string | null; code?: string | null; quantity?: number | null };
  errors: Issue[];
  warnings: Issue[];
};
type Preview = {
  valid: boolean;
  summary: Record<string, number>;
  itemRows: BatchRow[];
  openingBatchRows: BatchRow[];
};

/** Same Arabic headers the server accepts for the opening-balance sheet. */
const BALANCE_HEADERS = [
  'رمز المادة',
  'المستودع',
  'الكمية الافتتاحية',
  'رقم الدفعة',
  'تاريخ الصلاحية',
  'المورد',
  'رقم سند الإدخال',
  'تاريخ سند الإدخال',
];

/**
 * Opening-balance import (materials x warehouse) - admin only.
 *
 * Balances are never written directly: every row becomes a real inbound
 * movement tagged to its warehouse, so the batch ledger and the audit trail
 * stay authoritative. Preview runs on the server and never writes.
 */
export function CatalogBalancesPanel({
  knownWarehouseCodes,
  onDone,
}: {
  knownWarehouseCodes: string[];
  onDone?: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function downloadTemplate() {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([BALANCE_HEADERS]), 'الأرصدة الافتتاحية');
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([['المستودعات المعتمدة', ...knownWarehouseCodes]]),
        'القيم المرجعية',
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['قالب الأرصدة الافتتاحية — مواد فقط، لكل مستودع'],
          ['يجب أن تكون المادة معرّفة مسبقاً (من قالب تعريفات الكتالوج)، والمستودع موجوداً في «القيم المرجعية».'],
          ['لا تُكتب الأرصدة مباشرة: كل صف يُنشئ حركة إدخال افتتاحية باسم المستودع، ويظهر في تقرير الرصيد حسب المستودع.'],
          ['إن كانت المادة تتطلب دفعة فأدخل «رقم الدفعة»، وإن كانت تتطلب صلاحية فأدخل «تاريخ الصلاحية».'],
          ['「رقم سند الإدخال」 اختياري؛ عند تركه يُولّد النظام رقماً افتتاحياً مميزاً لكل مستودع.'],
        ]),
        'التعليمات',
      );
      const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `قالب-الأرصدة-الافتتاحية-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    setRows(null);
    try {
      const XLSX = await import('xlsx');
      let parsedRows: Array<Record<string, unknown>> = [];
      if (/\.csv$/i.test(file.name)) {
        const csvText = await file.text();
        const parsed = XLSX.read(csvText, { type: 'string' });
        const first = parsed.SheetNames[0];
        parsedRows = first
          ? (XLSX.utils.sheet_to_json(parsed.Sheets[first], { defval: '' }) as Array<Record<string, unknown>>)
          : [];
      } else {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const name = wb.SheetNames.find((n) => n.includes('الأرصدة')) ?? wb.SheetNames[0];
        const sheet = name ? wb.Sheets[name] : undefined;
        parsedRows = sheet
          ? (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Array<Record<string, unknown>>)
          : [];
      }
      if (parsedRows.length === 0) {
        setError('لم يُعثر على صفوف أرصدة في الملف.');
        return;
      }
      setFileName(file.name);
      setRows(parsedRows);
      const res = await fetch('/api/items/bulk-import/preview?mode=upsert', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingBatches: parsedRows }),
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
    if (!rows) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/items/bulk-import?mode=upsert', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingBatches: rows }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? 'تعذّر التنفيذ');
      const d = data as { openingBatches?: number };
      setMessage(`تم استيراد الأرصدة الافتتاحية: ${d.openingBatches ?? 0} دفعة.`);
      setPreview(null);
      setRows(null);
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
    const header = ['السطر', 'الرمز', 'المستودع', 'الخطورة', 'الرمز', 'الرسالة'];
    const out: string[][] = [header];
    for (const decision of preview.openingBatchRows) {
      for (const issue of [...decision.errors.map((i) => ({ ...i, severity: 'error' })), ...decision.warnings.map((i) => ({ ...i, severity: 'warning' }))]) {
        out.push([
          String(decision.rowNumber),
          decision.row.code ?? '',
          decision.row.warehouseCode ?? '',
          issue.severity === 'error' ? 'خطأ' : 'تنبيه',
          issue.code,
          issue.message,
        ]);
      }
    }
    const csv = out.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `أخطاء-الأرصدة-الافتتاحية-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = preview?.summary;
  const batchRows = preview?.openingBatchRows ?? [];
  const issues = batchRows.filter((d) => d.errors.length > 0 || d.warnings.length > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-primary" aria-hidden="true" /> استيراد الأرصدة الافتتاحية من Excel
          </CardTitle>
          <CardDescription>
            أرصدة المواد لكل مستودع. كل صف يُنشئ حركة إدخال افتتاحية باسم المستودع (لا تعديل مباشر للرصيد). المعاينة لا تكتب شيئًا، والتنفيذ ذرّي وللمدير فقط.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" className="gap-2" onClick={() => void downloadTemplate()}>
              <Download className="h-4 w-4" /> تنزيل قالب الأرصدة
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="balances-file">ملف Excel</Label>
              <input
                id="balances-file"
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
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
          {message && <p className="rounded-md border border-emerald-600/30 bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>معاينة الأرصدة</CardTitle>
              <CardDescription>
                صفوف {summary?.totalRows ?? 0} · دفعات جديدة {summary?.openingBatches ?? 0} · تنبيهات {summary?.warningRows ?? 0} · أخطاء {summary?.errorRows ?? 0}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {issues.length > 0 && (
                <Button variant="outline" className="gap-2" onClick={downloadIssues}>
                  <Download className="h-4 w-4" /> تقرير المشاكل
                </Button>
              )}
              <Button className="gap-2" onClick={() => void commit()} disabled={busy || (summary?.errorRows ?? 0) > 0}>
                {summary?.errorRows ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} تنفيذ الاستيراد
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(summary?.errorRows ?? 0) > 0 && (
              <p className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-sm text-amber-800">
                يوجد {summary?.errorRows} سطرًا بأخطاء؛ صحّح الملف ثم أعد الرفع (لا يُسمح بتنفيذ جزئي).
              </p>
            )}
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا مشاكل في الملف. ✅</p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>السطر</TableHead>
                      <TableHead>الرمز</TableHead>
                      <TableHead>المستودع</TableHead>
                      <TableHead>الرسالة</TableHead>
                      <TableHead>الخطورة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.slice(0, 150).flatMap((d) =>
                      [
                        ...d.errors.map((issue) => ({ issue, severity: 'error' as const })),
                        ...d.warnings.map((issue) => ({ issue, severity: 'warning' as const })),
                      ].map(({ issue, severity }, i) => (
                        <TableRow key={`${d.rowNumber}-${issue.code}-${i}`}>
                          <TableCell>{d.rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{d.row.code ?? '—'}</TableCell>
                          <TableCell>{d.row.warehouseCode ?? '—'}</TableCell>
                          <TableCell>{issue.message}</TableCell>
                          <TableCell>
                            {severity === 'error' ? <Badge variant="destructive">خطأ</Badge> : <Badge variant="outline">تنبيه</Badge>}
                          </TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">ملاحظات القالب</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>• المستودع إلزامي ويجب أن يطابق ورقة «القيم المرجعية» حرفيًا.</p>
          <p>• المادة يجب أن تكون معرّفة مسبقًا (من قالب تعريفات الكتالوج).</p>
          <p>• الكمية الافتتاحية عدد صحيح أكبر من الصفر.</p>
          <p>• المادة التي تتطلب رقم دفعة/صلاحية يجب أن يحمل صفّها هذين الحقلين.</p>
        </CardContent>
      </Card>
    </div>
  );
}
