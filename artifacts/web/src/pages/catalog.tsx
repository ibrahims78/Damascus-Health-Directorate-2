import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Plus, Ruler, Sparkles, Trash2, Wand2, Warehouse } from 'lucide-react';
import { CatalogImportPanel } from '@/components/catalog-import-panel';
import { CatalogBalancesPanel } from '@/components/catalog-balances-panel';
import { BinsPanel } from '@/components/bins-panel';

type Unit = { id: number; name: string; symbol: string | null; isActive: boolean; isSystem: boolean; sortOrder: number };
type WarehouseRow = { id: number; code: string; name: string; type: string; isActive: boolean };
type UsageRow = { unit: string; count: number; known: boolean };
type Item = { id: number; code: string | null; name: string; unit: string; minStock: number; isActive: boolean; itemType: string };
type Equipment = { id: number; code: string | null; name: string; equipmentType: string | null; condition: string; quantity: number; isActive: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? 'تعذّر تنفيذ العملية');
  return body as T;
}

const CONDITION_LABEL: Record<string, string> = {
  good: 'صالح', maintenance: 'صيانة', broken: 'تالف', consumed: 'مستهلك', needs_inspection: 'يحتاج فحص',
};

export function CatalogPage() {
  const { data: currentUser } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const isAdmin = currentUser?.role === 'admin';

  const [units, setUnits] = useState<Unit[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [unitDialog, setUnitDialog] = useState<{ open: boolean; id?: number; name: string; symbol: string }>({
    open: false, name: '', symbol: '',
  });
  const [normalize, setNormalize] = useState<{ open: boolean; from: string; to: string }>({ open: false, from: '', to: '' });
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [currentWarehouse, setCurrentWarehouse] = useState<WarehouseRow | null>(null);
  const [warehouseDialog, setWarehouseDialog] = useState<{ open: boolean; code: string; name: string; type: string }>({
    open: false, code: '', name: '', type: 'branch',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, i, e] = await Promise.all([
        api<Unit[]>(isAdmin ? '/units?includeArchived=1' : '/units'),
        api<{ items: Item[] }>('/items?limit=5000'),
        api<{ equipment: Equipment[] }>('/equipment?limit=5000'),
      ]);
      setUnits(u);
      setItems(i.items ?? []);
      setEquipment(e.equipment ?? []);
      try {
        const [whs, cur] = await Promise.all([
          api<WarehouseRow[]>(isAdmin ? '/warehouses?includeArchived=1' : '/warehouses'),
          api<WarehouseRow | null>('/warehouses/current'),
        ]);
        setWarehouses(Array.isArray(whs) ? whs : []);
        try {
          const cats = await api<Array<{ name: string }>>('/categories');
          setCategories(Array.isArray(cats) ? cats.map((c) => c.name) : []);
        } catch { /* categories optional */ }
        setCurrentWarehouse(cur ?? null);
      } catch { /* warehouse model optional */ }
      if (isAdmin) {
        try { setUsage(await api<UsageRow[]>('/units/usage')); } catch { setUsage([]); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ في التحميل');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'خطأ'); } finally { setBusy(false); }
  }

  async function seedUnits() {
    const r = await api<{ created: number }>('/units/seed-defaults', { method: 'POST' });
    setMessage(`تمت إضافة ${r.created} وحدة افتراضية.`);
    await load();
  }

  async function saveUnit() {
    const payload = { name: unitDialog.name.trim(), symbol: unitDialog.symbol.trim() || null };
    if (!payload.name) { setError('اسم الوحدة مطلوب.'); return; }
    if (unitDialog.id) await api(`/units/${unitDialog.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/units', { method: 'POST', body: JSON.stringify(payload) });
    setUnitDialog({ open: false, name: '', symbol: '' });
    setMessage('تم حفظ الوحدة.');
    await load();
  }

  async function archiveUnit(unit: Unit) {
    await api(`/units/${unit.id}`, { method: 'DELETE' });
    setMessage(`تمت أرشفة الوحدة «${unit.name}».`);
    await load();
  }

  async function restoreUnit(unit: Unit) {
    await api(`/units/${unit.id}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
    setMessage(`تم تفعيل الوحدة «${unit.name}».`);
    await load();
  }

  async function applyNormalize() {
    const r = await api<{ updated: number }>('/units/normalize', {
      method: 'POST',
      body: JSON.stringify({ from: normalize.from, to: normalize.to }),
    });
    setNormalize({ open: false, from: '', to: '' });
    setMessage(`تم توحيد ${r.updated} صنف.`);
    await load();
  }

  async function saveWarehouse() {
    const payload = { code: warehouseDialog.code.trim().toUpperCase(), name: warehouseDialog.name.trim(), type: warehouseDialog.type };
    if (!payload.code || !payload.name) { setError('رمز المستودع واسمه مطلوبان.'); return; }
    await api('/warehouses', { method: 'POST', body: JSON.stringify(payload) });
    setWarehouseDialog({ open: false, code: '', name: '', type: 'branch' });
    setMessage('تم إنشاء المستودع.');
    await load();
  }

  async function makeCurrent(wh: WarehouseRow) {
    await api('/warehouses/current', { method: 'POST', body: JSON.stringify({ id: wh.id }) });
    setMessage(`تم تعيين «${wh.name}» كمستودع هذا الجهاز.`);
    await load();
  }

  const filteredItems = useMemo(
    () => items.filter((i) => !search || i.name.includes(search) || (i.code ?? '').includes(search)),
    [items, search],
  );
  const filteredEquipment = useMemo(
    () => equipment.filter((e) => !search || e.name.includes(search) || (e.code ?? '').includes(search)),
    [equipment, search],
  );

  return (
    <main className="p-4 sm:p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" aria-hidden="true" />
            الكتالوج
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            التعريفات المعتمدة: الوحدات والمواد والتجهيزات. الكتالوج يُدار من المدير، والفروع تستهلكه.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => void run(seedUnits)} disabled={busy}>
              <Sparkles className="w-4 h-4" /> الوحدات الافتراضية
            </Button>
            <Button className="gap-2" onClick={() => setLocation('/items/new')}>
              <Plus className="w-4 h-4" /> مادة جديدة
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setLocation('/equipment/new')}>
              <Plus className="w-4 h-4" /> تجهيز جديد
            </Button>
          </div>
        )}
      </div>

      {(message || error) && (
        <div className={`rounded-lg border p-3 text-sm ${error ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-emerald-600/30 bg-emerald-50 text-emerald-800'}`}>
          {error ?? message}
        </div>
      )}

      <Tabs defaultValue="units" className="space-y-4">
        <TabsList>
          <TabsTrigger value="units" className="gap-2"><Ruler className="w-4 h-4" /> الوحدات</TabsTrigger>
          {isAdmin && <TabsTrigger value="import" className="gap-2">استيراد الكتالوج</TabsTrigger>}
          <TabsTrigger value="bins" className="gap-2">المواقع</TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-2"><Warehouse className="w-4 h-4" /> المستودعات</TabsTrigger>
          <TabsTrigger value="items" className="gap-2">المواد</TabsTrigger>
          <TabsTrigger value="equipment" className="gap-2">التجهيزات</TabsTrigger>
        </TabsList>

        {/* ---------------- Units ---------------- */}
        <TabsContent value="units" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>وحدات القياس المعيارية</CardTitle>
                <CardDescription>{units.length} وحدة مسجّلة</CardDescription>
              </div>
              {isAdmin && (
                <Button variant="outline" className="gap-2" onClick={() => setUnitDialog({ open: true, name: '', symbol: '' })}>
                  <Plus className="w-4 h-4" /> إضافة وحدة
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-40 w-full" />
              ) : units.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  لا توجد وحدات. {isAdmin ? 'أضف الوحدات الافتراضية أو أنشئ وحدات يدويًا.' : 'اطلب من المدير إعداد الوحدات.'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>الرمز</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead className="text-left">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {units.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell className="text-muted-foreground">{u.symbol ?? '—'}</TableCell>
                        <TableCell>
                          {u.isActive
                            ? <Badge variant="outline">مفعّلة</Badge>
                            : <Badge variant="secondary">مؤرشفة</Badge>}
                          {u.isSystem && <span className="text-[10px] text-muted-foreground ms-2">افتراضية</span>}
                        </TableCell>
                        <TableCell className="text-left">
                          {isAdmin && (
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setUnitDialog({ open: true, id: u.id, name: u.name, symbol: u.symbol ?? '' })}>
                                تعديل
                              </Button>
                              {u.isActive ? (
                                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void run(() => archiveUnit(u))} disabled={busy}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" onClick={() => void run(() => restoreUnit(u))} disabled={busy}>تفعيل</Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wand2 className="w-5 h-5 text-primary" /> توحيد الوحدات</CardTitle>
                <CardDescription>
                  الوحدات المكتوبة يدويًا في المواد والتي لا وجود لها في الكتالوج. وحّدها إلى وحدة معيارية.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {usage.filter((r) => !r.known && r.unit).length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد وحدات غير معيارية — الكتالوج موحّد. ✅</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الوحدة المكتوبة</TableHead>
                        <TableHead>عدد الأصناف</TableHead>
                        <TableHead className="text-left">إجراء</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.filter((r) => !r.known && r.unit).map((r) => (
                        <TableRow key={r.unit}>
                          <TableCell className="font-medium">{r.unit}</TableCell>
                          <TableCell>{r.count}</TableCell>
                          <TableCell className="text-left">
                            <Button variant="outline" size="sm" onClick={() => setNormalize({ open: true, from: r.unit, to: units.find((u) => u.isActive)?.name ?? '' })}>
                              توحيد
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          {isAdmin && (
            <>
              <CatalogImportPanel
                knownUnits={units.filter((u) => u.isActive).map((u) => u.name)}
                knownCategories={categories}
                knownWarehouseCodes={warehouses.filter((w) => w.isActive).map((w) => w.code)}
                onDone={() => void load()}
              />
              <CatalogBalancesPanel
                knownWarehouseCodes={warehouses.filter((w) => w.isActive).map((w) => w.code)}
                onDone={() => void load()}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="bins" className="space-y-4">
          <BinsPanel />
        </TabsContent>

        {/* ---------------- Warehouses ---------------- */}
        <TabsContent value="warehouses" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>المستودعات</CardTitle>
                <CardDescription>
                  مستودع هذا الجهاز: <b>{currentWarehouse?.name ?? '—'}</b> ({currentWarehouse?.code ?? '—'})
                </CardDescription>
              </div>
              {isAdmin && (
                <Button variant="outline" className="gap-2" onClick={() => setWarehouseDialog({ open: true, code: '', name: '', type: 'branch' })}>
                  <Plus className="w-4 h-4" /> إضافة مستودع
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {warehouses.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد مستودعات.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الرمز</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-left">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warehouses.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.code}</TableCell>
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell>{w.type === 'central' ? 'مركزي' : 'فرعي'}</TableCell>
                        <TableCell>{w.isActive ? <Badge variant="outline">فعّال</Badge> : <Badge variant="secondary">مؤرشف</Badge>}</TableCell>
                        <TableCell className="text-left">
                          {isAdmin && currentWarehouse?.id !== w.id && (
                            <Button variant="ghost" size="sm" onClick={() => void run(() => makeCurrent(w))} disabled={busy}>
                              تعيين كمستودع للجهاز
                            </Button>
                          )}
                          {currentWarehouse?.id === w.id && <span className="text-xs text-emerald-700">مستودع هذا الجهاز</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Items ---------------- */}
        <TabsContent value="items">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>المواد المعرّفة</CardTitle>
                <CardDescription>{filteredItems.length} مادة</CardDescription>
              </div>
              <Input placeholder="بحث بالاسم أو الرمز" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-40 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الرمز</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>الوحدة</TableHead>
                      <TableHead>الحد الأدنى</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.code ?? '—'}</TableCell>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell>{i.unit}</TableCell>
                        <TableCell>{i.minStock}</TableCell>
                        <TableCell>{i.isActive ? <Badge variant="outline">فعّالة</Badge> : <Badge variant="secondary">مؤرشفة</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Equipment ---------------- */}
        <TabsContent value="equipment">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>التجهيزات المعرّفة</CardTitle>
                <CardDescription>{filteredEquipment.length} تجهيز</CardDescription>
              </div>
              <Input placeholder="بحث بالاسم أو الرمز" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-40 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الرمز</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>الحالة الفنية</TableHead>
                      <TableHead>الكمية</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEquipment.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">{e.code ?? '—'}</TableCell>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell>{e.equipmentType ?? '—'}</TableCell>
                        <TableCell>{CONDITION_LABEL[e.condition] ?? e.condition}</TableCell>
                        <TableCell>{e.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Warehouse dialog */}
      <Dialog open={warehouseDialog.open} onOpenChange={(open) => setWarehouseDialog({ ...warehouseDialog, open })}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة مستودع</DialogTitle>
            <DialogDescription>الرمز يظهر في أرقام المستندات، لذا اجعله قصيرًا وثابتًا.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wh-code">الرمز</Label>
              <Input id="wh-code" value={warehouseDialog.code} onChange={(e) => setWarehouseDialog({ ...warehouseDialog, code: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-name">الاسم</Label>
              <Input id="wh-name" value={warehouseDialog.name} onChange={(e) => setWarehouseDialog({ ...warehouseDialog, name: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarehouseDialog({ open: false, code: '', name: '', type: 'branch' })}>إلغاء</Button>
            <Button onClick={() => void run(saveWarehouse)} disabled={busy}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unit dialog */}
      <Dialog open={unitDialog.open} onOpenChange={(open) => setUnitDialog({ ...unitDialog, open })}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{unitDialog.id ? 'تعديل وحدة' : 'إضافة وحدة'}</DialogTitle>
            <DialogDescription>اسم الوحدة يظهر في كل القوائم المنسدلة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="unit-name">اسم الوحدة</Label>
              <Input id="unit-name" value={unitDialog.name} onChange={(e) => setUnitDialog({ ...unitDialog, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-symbol">الرمز (اختياري)</Label>
              <Input id="unit-symbol" value={unitDialog.symbol} onChange={(e) => setUnitDialog({ ...unitDialog, symbol: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnitDialog({ open: false, name: '', symbol: '' })}>إلغاء</Button>
            <Button onClick={() => void run(saveUnit)} disabled={busy}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Normalize dialog */}
      <Dialog open={normalize.open} onOpenChange={(open) => setNormalize({ ...normalize, open })}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>توحيد الوحدة</DialogTitle>
            <DialogDescription>سيتم تحويل كل الأصناف التي وحدتها «{normalize.from}» إلى الوحدة المختارة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="normalize-to">الوحدة الهدف</Label>
            <Input id="normalize-to" value={normalize.to} onChange={(e) => setNormalize({ ...normalize, to: e.target.value })} list="units-list" />
            <datalist id="units-list">
              {units.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.name} />)}
            </datalist>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNormalize({ open: false, from: '', to: '' })}>إلغاء</Button>
            <Button onClick={() => void run(applyNormalize)} disabled={busy || !normalize.to}>توحيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
