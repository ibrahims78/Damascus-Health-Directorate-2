import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRightLeft, Plus, Printer, RefreshCw } from 'lucide-react';

type Warehouse = { id: number; code: string; name: string; type: string };
type Item = { id: number; code: string | null; name: string; unit: string };
type Transfer = {
  id: number; code: string; status: string; fromWarehouseId: number; toWarehouseId: number;
  provisional: boolean; deliveryNoteNumber: string | null; createdAt: string;
  lines?: Array<{ id: number; itemId: number; quantity: number; item: Item | null }>;
};

const STATUS_LABEL: Record<string, string> = {
  requested: 'مطلوب', issued: 'قيد النقل', received: 'مستلَم', rejected: 'مرفوض', cancelled: 'ملغى',
};

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

export function TransfersPage() {
  const { data: currentUser } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const canOperate = currentUser?.role === 'admin' || currentUser?.role === 'warehouse_manager';

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; from: string; to: string; itemId: string; quantity: string; batch: string; expiry: string }>({
    open: false, from: '', to: '', itemId: '', quantity: '1', batch: '', expiry: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, w, i] = await Promise.all([
        api<Transfer[]>('/transfers?limit=200'),
        api<Warehouse[]>('/warehouses'),
        api<{ items: Item[] }>('/items?limit=5000'),
      ]);
      setTransfers(Array.isArray(t) ? t : []);
      setWarehouses(Array.isArray(w) ? w : []);
      setItems(i.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ في التحميل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMessage(null); setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'خطأ'); } finally { setBusy(false); }
  }

  async function createTransfer() {
    const itemId = Number(dialog.itemId);
    const quantity = Number(dialog.quantity);
    const from = Number(dialog.from) || warehouses.find((w) => w.type === 'central')?.id;
    const to = Number(dialog.to);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0 || !to) { setError('اختر الصنف والكمية والمستودع الهدف.'); return; }
    await api('/transfers', {
      method: 'POST',
      body: JSON.stringify({
        fromWarehouseId: from, toWarehouseId: to,
        items: [{ itemId, quantity, batchNumber: dialog.batch || null, expiryDate: dialog.expiry || null }],
      }),
    });
    setDialog({ open: false, from: '', to: '', itemId: '', quantity: '1', batch: '', expiry: '' });
    setMessage('تم إنشاء طلب التحويل.');
    await load();
  }

  const action = (id: number, path: string, body?: unknown, ok?: string) =>
    run(async () => { await api(`/transfers/${id}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); setMessage(ok ?? 'تم.'); await load(); });

  return (
    <main className="p-4 sm:p-6 space-y-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6 text-primary" aria-hidden="true" /> التحويلات بين المستودعات
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            دورة الطلب ← الإرسال ← الاستلام. كل خطوة تُسجَّل محليًا وفورًا، والمزامنة تنقل ما حدث لاحقًا.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </Button>
          {canOperate && (
            <Button className="gap-2" onClick={() => setDialog({ ...dialog, open: true })}>
              <Plus className="w-4 h-4" /> طلب تحويل
            </Button>
          )}
        </div>
      </div>

      {message && <div className="rounded-lg border border-emerald-600/30 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>سجل التحويلات</CardTitle>
          <CardDescription>{transfers.length} تحويلًا</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full" /> : transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد تحويلات بعد.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>من → إلى</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.code}</TableCell>
                    <TableCell>
                      {warehouses.find((w) => w.id === t.fromWarehouseId)?.code ?? t.fromWarehouseId}
                      {' → '}
                      {warehouses.find((w) => w.id === t.toWarehouseId)?.code ?? t.toWarehouseId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === 'received' ? 'outline' : t.status === 'rejected' || t.status === 'cancelled' ? 'secondary' : 'default'}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      {t.provisional && <span className="ms-2 text-[10px] text-amber-700">إيصال مبدئي</span>}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex justify-end gap-1">
                        {canOperate && t.status === 'requested' && (
                          <Button size="sm" variant="outline" onClick={() => void action(t.id, 'issue', undefined, 'تم الإرسال.')} disabled={busy}>إرسال</Button>
                        )}
                        {canOperate && t.status === 'issued' && (
                          <Button size="sm" variant="outline" onClick={() => void action(t.id, 'receive', {}, 'تم الاستلام.')} disabled={busy}>استلام</Button>
                        )}
                        {canOperate && (t.status === 'requested' || t.status === 'issued') && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => void action(t.id, 'reject', { reason: 'غير مطلوب' }, 'تم الرفض.')} disabled={busy}>رفض</Button>
                            <Button size="sm" variant="ghost" onClick={() => void action(t.id, 'cancel', undefined, 'تم الإلغاء.')} disabled={busy}>إلغاء</Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => setLocation(`/transfers/${t.id}/print`)}>
                          <Printer className="w-4 h-4" /> طباعة
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog.open} onOpenChange={(open) => setDialog({ ...dialog, open })}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>طلب تحويل</DialogTitle>
            <DialogDescription>يُنشأ كطلب، ثم يُرسل من موقع المصدر ويُستلم في الوجهة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tr-from">من مستودع</Label>
              <select id="tr-from" className="w-full rounded-md border bg-background p-2 text-sm"
                value={dialog.from || String(warehouses.find((w) => w.type === 'central')?.id ?? '')}
                onChange={(e) => setDialog({ ...dialog, from: e.target.value })}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-to">إلى مستودع</Label>
              <select id="tr-to" className="w-full rounded-md border bg-background p-2 text-sm"
                value={dialog.to} onChange={(e) => setDialog({ ...dialog, to: e.target.value })}>
                <option value="">— اختر —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-item">الصنف</Label>
              <select id="tr-item" className="w-full rounded-md border bg-background p-2 text-sm"
                value={dialog.itemId} onChange={(e) => setDialog({ ...dialog, itemId: e.target.value })}>
                <option value="">— اختر —</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `[${i.code}] ` : ''}{i.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tr-qty">الكمية</Label>
                <Input id="tr-qty" type="number" min={1} value={dialog.quantity} onChange={(e) => setDialog({ ...dialog, quantity: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-batch">رقم الدفعة</Label>
                <Input id="tr-batch" value={dialog.batch} onChange={(e) => setDialog({ ...dialog, batch: e.target.value })} dir="ltr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-exp">الصلاحية</Label>
                <Input id="tr-exp" type="date" value={dialog.expiry} onChange={(e) => setDialog({ ...dialog, expiry: e.target.value })} dir="ltr" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ ...dialog, open: false })}>إلغاء</Button>
            <Button onClick={() => void run(createTransfer)} disabled={busy}>إنشاء الطلب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
