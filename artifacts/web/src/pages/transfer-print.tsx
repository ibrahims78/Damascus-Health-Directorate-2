import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { Barcode } from '@/components/barcode';

type Line = { id: number; itemId: number; quantity: number; unit: string | null; batchNumber: string | null; expiryDate: string | null; item: { id: number; code: string | null; name: string; unit: string } | null };

/**
 * Phase 8 - printable transfer document (A4). Reached from the transfers list.
 * A plain document that can be signed and filed next to the goods.
 */
export function TransferPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<{
    code: string; status: string; fromWarehouseId: number; toWarehouseId: number;
    requestedByName: string | null; issuedAt: string | null; receivedAt: string | null;
    deliveryNoteNumber: string | null; lines: Line[];
  } | null>(null);
  const [warehouses, setWarehouses] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [t, w] = await Promise.all([
        fetch(`/api/transfers/${id}`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('تعذّر تحميل التحويل')))),
        fetch('/api/warehouses', { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])),
      ]);
      setData(t);
      setWarehouses(Array.isArray(w) ? w : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const nameOf = (wid: number) => {
    const w = warehouses.find((x) => x.id === wid);
    return w ? `${w.name} (${w.code})` : String(wid);
  };

  if (error) return <main className="p-6" dir="rtl"><p className="text-destructive">{error}</p></main>;
  if (!data) return <main className="p-6" dir="rtl"><p className="text-sm text-muted-foreground">جارٍ التحميل…</p></main>;

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0" dir="rtl">
      <div className="mb-4 flex justify-end print:hidden">
        <Button className="gap-2" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> طباعة
        </Button>
      </div>

      <article className="border p-8 print:border-0">
        <header className="border-b pb-3 text-center">
          <h1 className="text-xl font-bold">مديرية صحة دمشق</h1>
          <p className="text-sm">مستند تحويل مخزني بين المستودعات</p>
        </header>

        <div className="mt-3 flex justify-center">
          <Barcode value={data.code} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div><dt className="inline text-muted-foreground">رقم التحويل: </dt><dd className="inline font-mono font-bold">{data.code}</dd></div>
          <div><dt className="inline text-muted-foreground">الحالة: </dt><dd className="inline">{data.status}</dd></div>
          <div><dt className="inline text-muted-foreground">من مستودع: </dt><dd className="inline">{nameOf(data.fromWarehouseId)}</dd></div>
          <div><dt className="inline text-muted-foreground">إلى مستودع: </dt><dd className="inline">{nameOf(data.toWarehouseId)}</dd></div>
          <div><dt className="inline text-muted-foreground">مقدّم الطلب: </dt><dd className="inline">{data.requestedByName ?? '—'}</dd></div>
          <div><dt className="inline text-muted-foreground">رقم الإرسالية: </dt><dd className="inline">{data.deliveryNoteNumber ?? '—'}</dd></div>
        </dl>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border p-2 text-right">#</th>
              <th className="border p-2 text-right">الرمز</th>
              <th className="border p-2 text-right">الصنف</th>
              <th className="border p-2 text-right">الكمية</th>
              <th className="border p-2 text-right">الدفعة</th>
              <th className="border p-2 text-right">الصلاحية</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, index) => (
              <tr key={line.id}>
                <td className="border p-2">{index + 1}</td>
                <td className="border p-2 font-mono text-xs">{line.item?.code ?? '—'}</td>
                <td className="border p-2">{line.item?.name ?? '—'}</td>
                <td className="border p-2">{line.quantity} {line.item?.unit ?? line.unit ?? ''}</td>
                <td className="border p-2">{line.batchNumber ?? '—'}</td>
                <td className="border p-2">{line.expiryDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-10 grid grid-cols-3 gap-6 text-sm">
          <div className="border-t pt-2">أمين المستودع المُرسِل<br /><span className="text-xs text-muted-foreground">التوقيع: ................</span></div>
          <div className="border-t pt-2">أمين المستودع المستقبِل<br /><span className="text-xs text-muted-foreground">التوقيع: ................</span></div>
          <div className="border-t pt-2">المدير<br /><span className="text-xs text-muted-foreground">التوقيع: ................</span></div>
        </section>
      </article>
    </main>
  );
}
