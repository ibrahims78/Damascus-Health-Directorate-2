import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Plus, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Item = { id: number; code: string | null; name: string; unit: string };
type ReceiptLine = {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
  rejectionReason: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
};
type Receipt = {
  id: number;
  code: string;
  status: 'draft' | 'posted' | 'cancelled';
  supplierName: string | null;
  deliveryNoteNumber: string | null;
  createdByName: string | null;
  receivedTotal: number;
  rejectedTotal: number;
  createdAt: string;
  lines?: ReceiptLine[];
};
type DraftLine = {
  itemId: string;
  orderedQuantity: string;
  receivedQuantity: string;
  rejectedQuantity: string;
  rejectionReason: string;
  batchNumber: string;
  expiryDate: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `فشل الطلب (${res.status})`);
  return data as T;
}

const emptyLine = (): DraftLine => ({
  itemId: '',
  orderedQuantity: '',
  receivedQuantity: '',
  rejectedQuantity: '',
  rejectionReason: '',
  batchNumber: '',
  expiryDate: '',
});

/**
 * Goods receipt note (GRN) with inspection - audit P0-2.
 * A draft never touches stock; posting moves only the accepted quantities into
 * the batch ledger, and rejected quantities need a reason.
 */
export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [draft, setDraft] = useState({
    supplierName: '',
    deliveryNoteNumber: '',
    deliveryNoteDate: new Date().toISOString().slice(0, 10),
    referenceNumber: '',
    notes: '',
    lines: [emptyLine()],
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, itemList] = await Promise.all([
        api<Receipt[]>('/receipts?limit=50'),
        api<{ items: Item[] }>('/items?limit=5000'),
      ]);
      setReceipts(Array.isArray(list) ? list : []);
      setItems(Array.isArray(itemList?.items) ? itemList.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل سندات الاستلام');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  async function create() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const lines = draft.lines
        .filter((line) => line.itemId)
        .map((line) => ({
          itemId: Number(line.itemId),
          orderedQuantity: line.orderedQuantity === '' ? 0 : Number(line.orderedQuantity),
          receivedQuantity: line.receivedQuantity === '' ? 0 : Number(line.receivedQuantity),
          rejectedQuantity: line.rejectedQuantity === '' ? 0 : Number(line.rejectedQuantity),
          rejectionReason: line.rejectionReason || null,
          batchNumber: line.batchNumber || null,
          expiryDate: line.expiryDate || null,
        }));
      if (lines.length === 0) {
        setError('أضف بندًا واحدًا على الأقل.');
        return;
      }
      const receipt = await api<Receipt>('/receipts', {
        method: 'POST',
        body: JSON.stringify({
          supplierName: draft.supplierName || null,
          deliveryNoteNumber: draft.deliveryNoteNumber || null,
          deliveryNoteDate: draft.deliveryNoteDate || null,
          referenceNumber: draft.referenceNumber || null,
          notes: draft.notes || null,
          lines,
        }),
      });
      setMessage(`أُنشئ سند الاستلام ${receipt.code} (مسودة). لا يدخل المخزون قبل الترحيل.`);
      setDraft({ supplierName: '', deliveryNoteNumber: '', deliveryNoteDate: new Date().toISOString().slice(0, 10), referenceNumber: '', notes: '', lines: [emptyLine()] });
      await load();
      await view(receipt.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء السند');
    } finally {
      setBusy(false);
    }
  }

  async function view(id: number) {
    try {
      setOpen(await api<Receipt>(`/receipts/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر فتح السند');
    }
  }

  async function post(id: number) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ receivedTotal: number; rejectedTotal: number }>(`/receipts/${id}/post`, { method: 'POST' });
      setMessage(`تم الترحيل: مقبول ${result.receivedTotal} · مرفوض ${result.rejectedTotal}.`);
      await load();
      await view(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر ترحيل السند');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api(`/receipts/${id}/cancel`, { method: 'POST' });
      setMessage('أُلغي السند.');
      setOpen(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إلغاء السند');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ClipboardCheck className="h-5 w-5 text-primary" aria-hidden="true" /> سندات الاستلام (GRN)
        </h1>
        <p className="text-sm text-muted-foreground">
          سند استلام بفحص: تُسجّل الكميات المطلوبة/المستلمة/المرفوضة، ولا يدخل المخزون إلا بالكميات المقبولة عند الترحيل.
        </p>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
      {message && <p className="rounded-md border border-emerald-600/30 bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">سند جديد</CardTitle>
          <CardDescription>عدّل الكميات المستلمة والمرفوضة، وسبب الرفض إلزامي عند وجود مرفوض.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="grn-supplier">المورّد</Label>
              <Input id="grn-supplier" value={draft.supplierName} onChange={(e) => setDraft((p) => ({ ...p, supplierName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grn-note">رقم سند التسليم</Label>
              <Input id="grn-note" value={draft.deliveryNoteNumber} onChange={(e) => setDraft((p) => ({ ...p, deliveryNoteNumber: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grn-date">تاريخ التسليم</Label>
              <Input id="grn-date" type="date" value={draft.deliveryNoteDate} onChange={(e) => setDraft((p) => ({ ...p, deliveryNoteDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grn-ref">المرجع (أمر شراء)</Label>
              <Input id="grn-ref" value={draft.referenceNumber} onChange={(e) => setDraft((p) => ({ ...p, referenceNumber: e.target.value }))} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>مطلوب</TableHead>
                  <TableHead>مستلم</TableHead>
                  <TableHead>مرفوض</TableHead>
                  <TableHead>سبب الرفض</TableHead>
                  <TableHead>الدفعة</TableHead>
                  <TableHead>الصلاحية</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <select
                        className="w-48 rounded-md border bg-background p-2 text-sm"
                        value={line.itemId}
                        onChange={(e) => updateLine(index, { itemId: e.target.value })}
                      >
                        <option value="">— اختر صنفًا —</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} {item.code ? `(${item.code})` : ''}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell><Input className="w-20" type="number" min={0} value={line.orderedQuantity} onChange={(e) => updateLine(index, { orderedQuantity: e.target.value })} /></TableCell>
                    <TableCell><Input className="w-20" type="number" min={0} value={line.receivedQuantity} onChange={(e) => updateLine(index, { receivedQuantity: e.target.value })} /></TableCell>
                    <TableCell><Input className="w-20" type="number" min={0} value={line.rejectedQuantity} onChange={(e) => updateLine(index, { rejectedQuantity: e.target.value })} /></TableCell>
                    <TableCell><Input value={line.rejectionReason} onChange={(e) => updateLine(index, { rejectionReason: e.target.value })} /></TableCell>
                    <TableCell><Input className="w-28" value={line.batchNumber} onChange={(e) => updateLine(index, { batchNumber: e.target.value })} /></TableCell>
                    <TableCell><Input className="w-36" type="date" value={line.expiryDate} onChange={(e) => updateLine(index, { expiryDate: e.target.value })} /></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" aria-label="حذف البند" onClick={() => setDraft((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== index) }))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setDraft((p) => ({ ...p, lines: [...p.lines, emptyLine()] }))}>
              <Plus className="h-4 w-4" /> إضافة بند
            </Button>
            <Button className="gap-2" onClick={() => void create()} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" /> حفظ كمسودة
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">السندات</CardTitle>
          <CardDescription>المسودة لا تؤثر على المخزون؛ الترحيل يعتمد الكميات المقبولة.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>المورّد</TableHead>
                <TableHead>سند التسليم</TableHead>
                <TableHead>مقبول</TableHead>
                <TableHead>مرفوض</TableHead>
                <TableHead>أنشأه</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-mono text-xs">{receipt.code}</TableCell>
                  <TableCell>
                    {receipt.status === 'posted' ? <Badge>مُرحّل</Badge> : receipt.status === 'cancelled' ? <Badge variant="outline">ملغى</Badge> : <Badge variant="secondary">مسودة</Badge>}
                  </TableCell>
                  <TableCell>{receipt.supplierName ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{receipt.deliveryNoteNumber ?? '—'}</TableCell>
                  <TableCell>{receipt.receivedTotal}</TableCell>
                  <TableCell>{receipt.rejectedTotal}</TableCell>
                  <TableCell>{receipt.createdByName ?? '—'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => void view(receipt.id)}>عرض</Button>
                  </TableCell>
                </TableRow>
              ))}
              {receipts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">لا توجد سندات استلام بعد.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {open && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">سند {open.code}</CardTitle>
              <CardDescription>
                {open.supplierName ?? 'بدون مورّد'} · سند التسليم {open.deliveryNoteNumber ?? '—'} · مقبول {open.receivedTotal} · مرفوض {open.rejectedTotal}
              </CardDescription>
            </div>
            {open.status === 'draft' && (
              <div className="flex gap-2">
                <Button className="gap-2" onClick={() => void post(open.id)} disabled={busy}>
                  <CheckCircle2 className="h-4 w-4" /> ترحيل (إدخال الكميات المقبولة)
                </Button>
                <Button variant="ghost" className="gap-2" onClick={() => void cancel(open.id)} disabled={busy}>
                  <XCircle className="h-4 w-4" /> إلغاء
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>مطلوب</TableHead>
                  <TableHead>مستلم</TableHead>
                  <TableHead>مرفوض</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>الدفعة</TableHead>
                  <TableHead>الصلاحية</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(open.lines ?? []).map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.itemName}</TableCell>
                    <TableCell>{line.orderedQuantity}</TableCell>
                    <TableCell>{line.receivedQuantity}</TableCell>
                    <TableCell className={Number(line.rejectedQuantity) > 0 ? 'font-semibold text-destructive' : ''}>{line.rejectedQuantity}</TableCell>
                    <TableCell>{line.rejectionReason ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{line.batchNumber ?? '—'}</TableCell>
                    <TableCell>{line.expiryDate ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
