import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Printer, Tag } from 'lucide-react';
import { Barcode } from '@/components/barcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocation } from 'wouter';

type Bin = {
  id: number;
  code: string;
  name: string;
  zone: string | null;
  warehouseCode: string | null;
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `فشل الطلب (${res.status})`);
  return data as T;
}

/**
 * Printable shelf labels (audit P1-6 follow-up).
 * Generates a sheet of location labels carrying the Code 39 barcode of the bin
 * code, its name, the zone and the warehouse.
 */
export default function LabelsPage() {
  const [, setLocation] = useLocation();
  const [bins, setBins] = useState<Bin[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api<Bin[]>('/bins');
      setBins(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل المواقع');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chosen = useMemo(() => bins.filter((bin) => selected.has(bin.id)), [bins, selected]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Tag className="h-5 w-5 text-primary" aria-hidden="true" /> ملصقات المواقع
          </h1>
          <p className="text-sm text-muted-foreground">
            اختر المواقع ثم اطبع الملصقات (باركود Code 39 + رمز الموقع والاسم والمنطقة).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setLocation('/catalog')}>
            <ArrowRight className="h-4 w-4" /> رجوع
          </Button>
          <Button variant="outline" onClick={() => setSelected(new Set(bins.map((bin) => bin.id)))}>
            تحديد الكل
          </Button>
          <Button variant="outline" onClick={() => setSelected(new Set())}>
            إلغاء التحديد
          </Button>
          <Button className="gap-2" disabled={chosen.length === 0} onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> طباعة ({chosen.length})
          </Button>
        </div>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive print:hidden">{error}</p>}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">اختيار المواقع</CardTitle>
          <CardDescription>المواقع المعرّفة في كتالوج المواقع.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3">
            {bins.map((bin) => (
              <label key={bin.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                <input type="checkbox" checked={selected.has(bin.id)} onChange={() => toggle(bin.id)} />
                <span className="font-mono text-xs">{bin.code}</span>
                <span>{bin.name}</span>
                {bin.zone ? <span className="text-xs text-muted-foreground">({bin.zone})</span> : null}
              </label>
            ))}
            {bins.length === 0 && <p className="text-sm text-muted-foreground">لا توجد مواقع — أضِفها من تبويب «المواقع» في الكتالوج.</p>}
          </div>
        </CardContent>
      </Card>

      {/* print sheet */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {chosen.map((bin) => (
          <div
            key={bin.id}
            style={{ border: '1px solid #111827', borderRadius: '6px', padding: '10px', textAlign: 'center', breakInside: 'avoid' }}
          >
            <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '2px' }}>{bin.code}</div>
            <div style={{ fontSize: '12px', color: '#374151', marginBottom: '6px' }}>
              {bin.name}
              {bin.zone ? ` · ${bin.zone}` : ''}
            </div>
            <Barcode value={bin.code} height={44} />
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
              {bin.warehouseCode ? `المستودع: ${bin.warehouseCode}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
