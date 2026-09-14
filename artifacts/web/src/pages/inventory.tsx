import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Boxes, ClipboardList, PackageSearch, RefreshCw, Scale, TriangleAlert } from 'lucide-react';

type Item = { id: number; code: string | null; name: string; unit: string; currentStock: number; minStock: number; isActive: boolean };
type Equipment = { id: number; name: string; condition: string; quantity: number; minQuantity: number };
type Mismatch = { id: number; code: string | null; name: string; unit: string; currentStock: number; batchTotal: number; batchCount: number; delta: number };
type Reconciliation = { checked: number; mismatches: number; items: Mismatch[]; generatedAt: string };
type Consolidated = {
  totals: { items: number; equipment: number; quantity: number; belowMin: number; warehouses: number };
  warehouses: Array<{ warehouseId: number; warehouse: { id: number; code: string; name: string; type: string } | null; lines: number; quantity: number; belowMin: number }>;
  generatedAt: string;
};

const CONDITION_LABEL: Record<string, string> = {
  good: 'صالح', maintenance: 'صيانة', broken: 'تالف', consumed: 'مستهلك', needs_inspection: 'يحتاج فحص',
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? 'تعذّر التحميل');
  return body as T;
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'warn' | 'danger' }) {
  const toneClass =
    tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-amber-600' : 'text-primary';
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

export function InventoryPage() {
  const { data: currentUser } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const isAdmin = currentUser?.role === 'admin';

  const [items, setItems] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [consolidated, setConsolidated] = useState<Consolidated | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, e] = await Promise.all([
        api<{ items: Item[] }>('/items?limit=5000'),
        api<{ equipment: Equipment[] }>('/equipment?limit=5000'),
      ]);
      setItems(i.items ?? []);
      setEquipment(e.equipment ?? []);
      if (isAdmin) {
        try { setRecon(await api<Reconciliation>('/reports/reconciliation')); } catch { setRecon(null); }
        try { setConsolidated(await api<Consolidated>('/reports/consolidated')); } catch { setConsolidated(null); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ في التحميل');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  const belowMin = items.filter((i) => i.isActive && i.minStock > 0 && i.currentStock < i.minStock);
  const byCondition = equipment.reduce<Record<string, number>>((acc, e) => {
    acc[e.condition] = (acc[e.condition] ?? 0) + 1;
    return acc;
  }, {});
  const attention = equipment.filter((e) => e.condition === 'maintenance' || e.condition === 'needs_inspection' || e.condition === 'broken').length;

  return (
    <main className="p-4 sm:p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="w-6 h-6 text-primary" aria-hidden="true" />
            مركز المخزون
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">صورة موحّدة للمخزون: الأرصدة، النواقص، حالة التجهيزات، وسلامة البيانات.</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </Button>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="أصناف المواد" value={items.filter((i) => i.isActive).length} />
            <Stat label="التجهيزات" value={equipment.length} />
            <Stat label="مواد تحت الحد الأدنى" value={belowMin.length} tone={belowMin.length ? 'warn' : 'default'} />
            <Stat label="تجهيزات تحتاج متابعة" value={attention} tone={attention ? 'danger' : 'default'} />
          </div>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-primary" /> ترصيد الأرصدة مع الدفعات
                </CardTitle>
                <CardDescription>
                  {recon
                    ? `تم فحص ${recon.checked} صنفًا · ${recon.mismatches} صنفًا بفرق`
                    : 'غير متاح'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!recon || recon.mismatches === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد فروقات — الأرصدة مطابقة لمجموع الدفعات. ✅</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الرمز</TableHead>
                        <TableHead>الصنف</TableHead>
                        <TableHead>الرصيد المسجّل</TableHead>
                        <TableHead>مجموع الدفعات</TableHead>
                        <TableHead>الفرق</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recon.items.slice(0, 50).map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-mono text-xs">{m.code ?? '—'}</TableCell>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell>{m.currentStock} {m.unit}</TableCell>
                          <TableCell>{m.batchTotal}</TableCell>
                          <TableCell className={m.delta < 0 ? 'text-destructive font-bold' : 'text-amber-600 font-bold'}>
                            {m.delta > 0 ? `+${m.delta}` : m.delta}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {isAdmin && consolidated && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Scale className="w-5 h-5 text-primary" /> التقارير الموحّدة (كل المواقع)
                </CardTitle>
                <CardDescription>
                  {consolidated.totals.warehouses} مستودعًا · إجمالي الكميات {consolidated.totals.quantity} ·
                  أصناف تحت الحد الأدنى {consolidated.totals.belowMin}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المستودع</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>عدد الأصناف</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>تحت الحد الأدنى</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consolidated.warehouses.map((w) => (
                      <TableRow key={w.warehouseId}>
                        <TableCell className="font-medium">{w.warehouse ? `${w.warehouse.name} (${w.warehouse.code})` : String(w.warehouseId)}</TableCell>
                        <TableCell>{w.warehouse?.type === 'central' ? 'مركزي' : 'فرعي'}</TableCell>
                        <TableCell>{w.lines}</TableCell>
                        <TableCell>{w.quantity}</TableCell>
                        <TableCell className={w.belowMin > 0 ? 'text-amber-600 font-bold' : ''}>{w.belowMin}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TriangleAlert className="w-5 h-5 text-amber-600" /> مواد تحت الحد الأدنى
                </CardTitle>
                <CardDescription>{belowMin.length} صنفًا يحتاج تزويدًا</CardDescription>
              </CardHeader>
              <CardContent>
                {belowMin.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد نواقص. ✅</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead>الرصيد</TableHead>
                        <TableHead>الحد الأدنى</TableHead>
                        <TableHead>النقص</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {belowMin.slice(0, 50).map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-medium">{i.name}</TableCell>
                          <TableCell>{i.currentStock} {i.unit}</TableCell>
                          <TableCell>{i.minStock}</TableCell>
                          <TableCell className="text-destructive font-bold">{i.minStock - i.currentStock}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PackageSearch className="w-5 h-5 text-primary" /> التجهيزات حسب الحالة
                </CardTitle>
                <CardDescription>{equipment.length} تجهيزًا</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الحالة</TableHead>
                      <TableHead>العدد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(byCondition).map(([condition, count]) => (
                      <TableRow key={condition}>
                        <TableCell>{CONDITION_LABEL[condition] ?? condition}</TableCell>
                        <TableCell><Badge variant="outline">{count}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-primary" /> روابط سريعة
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setLocation('/catalog')}>الكتالوج</Button>
              <Button variant="outline" onClick={() => setLocation('/items')}>المواد</Button>
              <Button variant="outline" onClick={() => setLocation('/equipment')}>التجهيزات</Button>
              <Button variant="outline" onClick={() => setLocation('/transactions')}>الحركات</Button>
              <Button variant="outline" onClick={() => setLocation('/reports')}>التقارير</Button>
              <Button variant="outline" onClick={() => setLocation('/print/report/stock')}>طباعة كشف الأرصدة</Button>
              <Button variant="outline" onClick={() => setLocation('/print/report/below-min')}>طباعة كشف النواقص</Button>
              <Button variant="outline" onClick={() => setLocation('/print/report/expiry')}>طباعة كشف الصلاحية</Button>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
