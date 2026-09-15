import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Printer, ArrowRight, RefreshCw } from 'lucide-react';
import { Barcode } from '@/components/barcode';

type Kind = 'stock' | 'below-min' | 'expiry';

type Row = {
  id: number;
  code: string | null;
  name: string;
  categoryName?: string | null;
  unit: string;
  currentStock: number;
  minStock?: number | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  location?: string | null;
};

const META: Record<Kind, { title: string; columns: string[] }> = {
  stock: { title: 'كشف أرصدة المواد', columns: ['#', 'الرمز', 'الصنف', 'التصنيف', 'الوحدة', 'الرصيد', 'الحد الأدنى', 'الموقع'] },
  'below-min': { title: 'كشف المواد تحت الحد الأدنى', columns: ['#', 'الرمز', 'الصنف', 'الوحدة', 'الرصيد', 'الحد الأدنى', 'النقص', 'الموقع'] },
  expiry: { title: 'كشف المواد ذات تاريخ الصلاحية', columns: ['#', 'الرمز', 'الصنف', 'الوحدة', 'رقم الدفعة', 'الصلاحية', 'الرصيد', 'الموقع'] },
};

function cell(kind: Kind, row: Row, index: number): Array<string | number> {
  const code = row.code ?? '—';
  if (kind === 'stock') {
    return [index + 1, code, row.name, row.categoryName ?? '—', row.unit, row.currentStock, row.minStock ?? '—', row.location ?? '—'];
  }
  if (kind === 'below-min') {
    const deficit = (row.minStock ?? 0) - row.currentStock;
    return [index + 1, code, row.name, row.unit, row.currentStock, row.minStock ?? '—', deficit > 0 ? deficit : 0, row.location ?? '—'];
  }
  return [index + 1, code, row.name, row.unit, row.batchNumber ?? '—', row.expiryDate ?? '—', row.currentStock, row.location ?? '—'];
}

/**
 * Phase 8 (P2) - batch printable reports: stock / below-minimum / expiry.
 * One A4 sheet per kind, produced from the read-only report endpoints.
 */
export function PrintReportPage() {
  const [, params] = useRoute('/print/report/:kind');
  const [, setLocation] = useLocation();
  const kind = (params?.kind ?? 'stock') as Kind;
  const meta = META[kind] ?? META.stock;

  const [rows, setRows] = useState<Row[]>([]);
  const [warehouse, setWarehouse] = useState<{ code: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportRes, whRes] = await Promise.all([
        fetch(`/api/reports/${kind}`, { credentials: 'include' }),
        fetch('/api/warehouses/current', { credentials: 'include' }).catch(() => null),
      ]);
      if (!reportRes.ok) throw new Error('تعذّر تحميل الكشف');
      const data = (await reportRes.json()) as Row[];
      setRows(Array.isArray(data) ? data : []);
      if (whRes && whRes.ok) {
        const wh = (await whRes.json()) as { code: string; name: string } | null;
        setWarehouse(wh ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  const barcodeRef = useMemo(() => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'RPT-' + kind.toUpperCase() + '-' + stamp;
  }, [kind]);

  const totalStock = useMemo(() => rows.reduce((sum, r) => sum + Number(r.currentStock ?? 0), 0), [rows]);

  if (loading) {
    return <main className="flex h-screen items-center justify-center bg-gray-100 text-gray-500" dir="rtl">جارٍ تحميل الكشف…</main>;
  }
  if (error) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-gray-100" dir="rtl">
        <p className="text-red-600">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> إعادة المحاولة</Button>
          <Button variant="ghost" className="gap-2" onClick={() => setLocation('/reports')}><ArrowRight className="h-4 w-4" /> رجوع</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6 print:p-0" dir="rtl">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="outline" className="gap-2" onClick={() => setLocation('/reports')}>
          <ArrowRight className="h-4 w-4" /> رجوع
        </Button>
        <Button className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> طباعة
        </Button>
      </div>

      <article className="border p-8 print:border-0">
        <header className="border-b pb-3 text-center">
          <h1 className="text-xl font-bold">مديرية صحة دمشق</h1>
          <p className="text-sm">{meta.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            التاريخ: {new Date().toLocaleDateString('ar-SY')}
            {warehouse ? ` · المستودع: ${warehouse.name} (${warehouse.code})` : ''}
            {` · عدد السطور: ${rows.length}`}
          </p>
        </header>

        <div className="mt-3 flex justify-center">
          <Barcode value={barcodeRef} />
        </div>

        {rows.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">لا توجد بيانات لهذا الكشف.</p>
        ) : (
          <table className="mt-5 w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {meta.columns.map((c) => (
                  <th key={c} className="border p-2 text-right font-bold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  {cell(kind, row, index).map((value, i) => (
                    <td key={i} className="border p-2">{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="border p-2 font-bold" colSpan={meta.columns.length - 1}>
                  الإجمالي (عدد السطور: {rows.length})
                </td>
                <td className="border p-2 font-bold">{totalStock}</td>
              </tr>
            </tfoot>
          </table>
        )}

        <div className="mt-8 grid grid-cols-3 gap-6 text-[13px]">
          {['أمين المستودع', 'المراجع', 'المدير'].map((label) => (
            <div key={label} className="border-t pt-2">
              <div className="font-semibold">{label}</div>
              <div className="text-xs text-muted-foreground">الاسم: ....................</div>
              <div className="text-xs text-muted-foreground">التوقيع: ....................</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          كشف مُستخرَج من النظام — يُعتمد بعد التوقيع، وتُحفظ نسخة أصلية ونسخة صورة.
        </p>
      </article>
    </main>
  );
}
