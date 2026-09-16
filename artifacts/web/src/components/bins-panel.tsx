import { useCallback, useEffect, useState } from 'react';
import { Archive, MapPin, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Bin = {
  id: number;
  code: string;
  name: string;
  zone: string | null;
  warehouseId: number;
  warehouseCode: string | null;
  notes: string | null;
  isActive: boolean;
};
type Usage = { binCode: string; items: number; known: boolean };

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

/** Structured storage locations (audit P1-6): zone -> bin code, with usage check. */
export function BinsPanel() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [form, setForm] = useState({ code: '', name: '', zone: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, stats] = await Promise.all([api<Bin[]>('/bins'), api<Usage[]>('/bins/usage')]);
      setBins(Array.isArray(list) ? list : []);
      setUsage(Array.isArray(stats) ? stats : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل المواقع');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const bin = await api<Bin>('/bins', {
        method: 'POST',
        body: JSON.stringify({ code: form.code, name: form.name, zone: form.zone || null }),
      });
      setMessage(`أُضيف الموقع ${bin.code}.`);
      setForm({ code: '', name: '', zone: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إضافة الموقع');
    } finally {
      setBusy(false);
    }
  }

  async function archive(bin: Bin) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api(`/bins/${bin.id}`, { method: 'DELETE' });
      setMessage(`أُرشف الموقع ${bin.code}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر أرشفة الموقع');
    } finally {
      setBusy(false);
    }
  }

  const usageByCode = new Map(usage.map((row) => [row.binCode, row.items]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" aria-hidden="true" /> مواقع التخزين (Zone / Bin)
          </CardTitle>
          <CardDescription>
            رمز فريد للموقع مع منطقة ومستودع؛ يُسند للصنف في حقل «الموقع»، ولا يُؤرشف موقع مستخدم في أصناف.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
          {message && <p className="rounded-md border border-emerald-600/30 bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}
          <div className="grid gap-3 md:grid-cols-4 md:items-end">
            <div className="space-y-1">
              <Label htmlFor="bin-code">الرمز</Label>
              <Input id="bin-code" placeholder="A-01-1" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bin-name">الاسم</Label>
              <Input id="bin-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bin-zone">المنطقة</Label>
              <Input id="bin-zone" placeholder="A" value={form.zone} onChange={(e) => setForm((p) => ({ ...p, zone: e.target.value }))} />
            </div>
            <Button className="gap-2" onClick={() => void create()} disabled={busy || !form.code || !form.name}>
              <Plus className="h-4 w-4" /> إضافة موقع
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>المنطقة</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>الأصناف</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bins.map((bin) => {
                const items = usageByCode.get(bin.code) ?? 0;
                return (
                  <TableRow key={bin.id}>
                    <TableCell className="font-mono text-xs">{bin.code}</TableCell>
                    <TableCell>{bin.name}</TableCell>
                    <TableCell>{bin.zone ?? '—'}</TableCell>
                    <TableCell>{bin.warehouseCode ?? '—'}</TableCell>
                    <TableCell>{items > 0 ? <Badge variant="secondary">{items}</Badge> : '—'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        disabled={busy}
                        onClick={() => void archive(bin)}
                        title={items > 0 ? 'لا يمكن أرشفة موقع مستخدم' : 'أرشفة الموقع'}
                      >
                        <Archive className="h-4 w-4" /> أرشفة
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {bins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">لا توجد مواقع بعد.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {usage.some((row) => !row.known) && (
            <div className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs text-amber-800">
              رموز مواقع مستخدمة في الأصناف لكنها غير معرّفة في الكتالوج:{' '}
              {usage.filter((row) => !row.known).map((row) => `${row.binCode} (${row.items})`).join(' · ')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
