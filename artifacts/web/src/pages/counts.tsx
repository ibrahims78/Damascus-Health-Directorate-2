import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Plus, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useGetCurrentUser } from '@workspace/api-client-react';

type CountLine = {
  id: number;
  itemId: number;
  itemCode: string | null;
  itemName: string;
  unit: string;
  binCode: string | null;
  systemQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  varianceReason: string | null;
};

type CountSession = {
  id: number;
  code: string;
  status: 'open' | 'approved' | 'cancelled';
  blindCount: boolean;
  linesCount: number;
  countedLines: number;
  varianceLines: number;
  totalVariance: number;
  createdByName: string | null;
  approvedByName: string | null;
  startedAt: string;
  approvedAt: string | null;
  lines?: CountLine[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `فشل الطلب (${res.status})`);
  return data as T;
}

/**
 * Cycle counting (warehouse-practice audit, P0).
 *
 * The counter enters the physical quantity per line (blind by default: the
 * system figure stays hidden until the admin approves). Approval posts every
 * difference as an audited adjustment, so the batch ledger stays the source of
 * truth; nothing is written before approval.
 */
export default function CountsPage() {
  const { data: user } = useGetCurrentUser();
  const isAdmin = user?.role === 'admin';
  const [sessions, setSessions] = useState<CountSession[]>([]);
  const [active, setActive] = useState<CountSession | null>(null);
  const [entries, setEntries] = useState<Record<number, { counted: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealSystem, setRevealSystem] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await api<CountSession[]>('/counts?limit=50'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل جلسات الجرد');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(session: CountSession) {
    setError(null);
    setMessage(null);
    try {
      const detail = await api<CountSession>(`/counts/${session.id}`);
      setActive(detail);
      setRevealSystem(false);
      const next: Record<number, { counted: string; reason: string }> = {};
      for (const line of detail.lines ?? []) {
        next[line.id] = {
          counted: line.countedQuantity === null ? '' : String(line.countedQuantity),
          reason: line.varianceReason ?? '',
        };
      }
      setEntries(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر فتح الجلسة');
    }
  }

  async function createSession() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const session = await api<CountSession>('/counts', {
        method: 'POST',
        body: JSON.stringify({ blindCount: true }),
      });
      setMessage(`أُنشئت جلسة الجرد ${session.code} بعدد ${session.linesCount} صنفًا.`);
      await load();
      await open(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إنشاء الجلسة');
    } finally {
      setBusy(false);
    }
  }

  async function saveEntries() {
    if (!active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = (active.lines ?? [])
        .filter((line) => entries[line.id]?.counted !== '' && entries[line.id]?.counted !== undefined)
        .map((line) => ({
          lineId: line.id,
          countedQuantity: Number(entries[line.id].counted),
          varianceReason: entries[line.id].reason || null,
        }));
      if (payload.length === 0) {
        setError('أدخل كمية واحدة على الأقل.');
        return;
      }
      await api(`/counts/${active.id}/entries`, { method: 'POST', body: JSON.stringify({ entries: payload }) });
      const detail = await api<CountSession>(`/counts/${active.id}`);
      setActive(detail);
      setMessage('حُفظت الكميات المجرودة.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر حفظ الكميات');
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ posted: number }>(`/counts/${active.id}/approve`, { method: 'POST' });
      setMessage(`اعتُمدت الجلسة ورُحّلت ${result.posted} تسوية.`);
      setActive(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر اعتماد الجلسة');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!active) return;
    setBusy(true);
    try {
      await api(`/counts/${active.id}/cancel`, { method: 'POST' });
      setMessage('أُلغيت الجلسة.');
      setActive(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر إلغاء الجلسة');
    } finally {
      setBusy(false);
    }
  }

  const pending = useMemo(
    () => (active?.lines ?? []).filter((line) => entries[line.id]?.counted !== '' && entries[line.id]?.counted !== undefined).length,
    [active, entries],
  );
  const varianceCount = useMemo(
    () =>
      (active?.lines ?? []).filter((line) => {
        const raw = entries[line.id]?.counted;
        if (raw === '' || raw === undefined) return false;
        return Number(raw) !== Number(line.systemQuantity);
      }).length,
    [active, entries],
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" /> الجرد الدوري
          </h1>
          <p className="text-sm text-muted-foreground">
            جرد أعمى فيزيائي، ثم اعتماد من المدير يرحّل الفروق كتسويات موثّقة (يبقى سجل الدفعات مصدر الحقيقة).
          </p>
        </div>
        {isAdmin || user?.role === 'warehouse_manager' ? (
          <Button className="gap-2" onClick={() => void createSession()} disabled={busy}>
            <Plus className="h-4 w-4" /> جلسة جرد جديدة
          </Button>
        ) : null}
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
      {message && <p className="rounded-md border border-emerald-600/30 bg-emerald-50 p-2 text-sm text-emerald-800">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الجلسات</CardTitle>
          <CardDescription>اعرض الجلسة لإدخال الكميات أو لاعتمادها.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرمز</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الأسطر</TableHead>
                <TableHead>المجرود</TableHead>
                <TableHead>فروق</TableHead>
                <TableHead>صافي الفرق</TableHead>
                <TableHead>أنشأها</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-mono text-xs">{session.code}</TableCell>
                  <TableCell>
                    {session.status === 'approved' ? (
                      <Badge>معتمدة</Badge>
                    ) : session.status === 'cancelled' ? (
                      <Badge variant="outline">ملغاة</Badge>
                    ) : (
                      <Badge variant="secondary">مفتوحة</Badge>
                    )}
                  </TableCell>
                  <TableCell>{session.linesCount}</TableCell>
                  <TableCell>{session.countedLines}</TableCell>
                  <TableCell>{session.varianceLines}</TableCell>
                  <TableCell className={Number(session.totalVariance) !== 0 ? 'font-semibold text-destructive' : ''}>
                    {session.totalVariance}
                  </TableCell>
                  <TableCell>{session.createdByName ?? '—'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => void open(session)}>
                      {session.status === 'open' ? 'إدخال / اعتماد' : 'عرض'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {sessions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    لا توجد جلسات جرد بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {active && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">جلسة {active.code}</CardTitle>
              <CardDescription>
                {active.blindCount ? 'جرد أعمى — الكمية الدفترية مخفية.' : 'الكمية الدفترية ظاهرة.'} · أُدخل {pending} من {active.lines?.length ?? 0} · فروق {varianceCount}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {active.blindCount && (
                <Button variant="outline" onClick={() => setRevealSystem((value) => !value)}>
                  {revealSystem ? 'إخفاء الكمية الدفترية' : 'كشف الكمية الدفترية'}
                </Button>
              )}
              {active.status === 'open' && (
                <>
                  <Button variant="outline" className="gap-2" onClick={() => void saveEntries()} disabled={busy}>
                    <CheckCircle2 className="h-4 w-4" /> حفظ الكميات
                  </Button>
                  {isAdmin && (
                    <Button className="gap-2" onClick={() => void approve()} disabled={busy || varianceCount > 0 && (active.lines ?? []).some((line) => {
                      const raw = entries[line.id]?.counted;
                      return raw !== undefined && raw !== '' && Number(raw) !== Number(line.systemQuantity) && !entries[line.id]?.reason;
                    })}>
                      <AlertTriangle className="h-4 w-4" /> اعتماد وترحيل الفروق
                    </Button>
                  )}
                  {isAdmin && (
                    <Button variant="ghost" className="gap-2" onClick={() => void cancel()} disabled={busy}>
                      <XCircle className="h-4 w-4" /> إلغاء
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الموقع</TableHead>
                  <TableHead>الوحدة</TableHead>
                  {(!active.blindCount || revealSystem) && <TableHead>الدفترية</TableHead>}
                  <TableHead>المجرودة</TableHead>
                  <TableHead>الفرق</TableHead>
                  <TableHead>سبب الفرق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(active.lines ?? []).map((line) => {
                  const entry = entries[line.id] ?? { counted: '', reason: '' };
                  const counted = entry.counted === '' ? null : Number(entry.counted);
                  const variance = counted === null ? null : counted - Number(line.systemQuantity);
                  const readOnly = active.status !== 'open';
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-medium">{line.itemName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{line.itemCode ?? '—'}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{line.binCode ?? '—'}</TableCell>
                      <TableCell>{line.unit}</TableCell>
                      {(!active.blindCount || revealSystem) && <TableCell>{line.systemQuantity}</TableCell>}
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          className="w-24"
                          value={entry.counted}
                          disabled={readOnly}
                          onChange={(event) =>
                            setEntries((prev) => ({ ...prev, [line.id]: { ...entry, counted: event.target.value } }))
                          }
                        />
                      </TableCell>
                      <TableCell className={variance ? 'font-semibold text-destructive' : ''}>{variance === null ? '—' : variance}</TableCell>
                      <TableCell>
                        <Input
                          placeholder="سبب الفرق (إلزامي عند وجود فرق)"
                          value={entry.reason}
                          disabled={readOnly}
                          onChange={(event) =>
                            setEntries((prev) => ({ ...prev, [line.id]: { ...entry, reason: event.target.value } }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {varianceCount > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                يوجد {varianceCount} فرقًا: يجب تسجيل سبب لكل فرق قبل الاعتماد، ولا يمكن الاعتماد قبل جرد كل الأسطر.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
