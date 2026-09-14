import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  ClipboardList,
  FileWarning,
  History,
  Package,
  Printer,
  RotateCcw,
  Search,
  Wrench,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/copy-button';

type MovementType =
  | 'in'
  | 'out'
  | 'adjust'
  | 'custody_out'
  | 'custody_return'
  | 'damage'
  | 'central_return';

type ItemHistoryResponse = {
  item: {
    id: number;
    code: string | null;
    name: string;
    categoryName: string | null;
    itemType: string;
    unit: string;
    currentStock: number;
    minStock: number;
    expiryDate: string | null;
    location: string | null;
    supplier: string | null;
    notes: string | null;
    isActive: boolean;
  };
  batches: Array<{
    id: number;
    batchNumber: string | null;
    receivedQuantity: number;
    remainingQuantity: number;
    expiryDate: string | null;
    deliveryNoteNumber: string | null;
    deliveryNoteDate: string | null;
  }>;
  movements: Array<{
    id: number;
    type: MovementType;
    quantity: number | null;
    partyName: string | null;
    documentNumber: string;
    documentDate: string | null;
    createdAt: string;
    operatorName: string | null;
    expiryDate: string | null;
    batchNumber: string | null;
    reason: string | null;
    notes: string | null;
    isHistoricalIncomplete: boolean;
    allocations: Array<{
      batchId: number;
      quantity: number;
      batchNumber: string | null;
      expiryDate: string | null;
    }>;
  }>;
  total: number;
  page: number;
  limit: number;
};

const TYPE_META: Record<MovementType, {
  label: string;
  icon: typeof ArrowDownToLine;
  className: string;
}> = {
  in: { label: 'إدخال', icon: ArrowDownToLine, className: 'text-emerald-700 bg-emerald-100 border-emerald-200' },
  out: { label: 'إخراج مستهلكات', icon: ArrowUpFromLine, className: 'text-red-700 bg-red-100 border-red-200' },
  adjust: { label: 'تسوية جرد', icon: ClipboardList, className: 'text-amber-700 bg-amber-100 border-amber-200' },
  custody_out: { label: 'تسليم عهدة', icon: Wrench, className: 'text-blue-700 bg-blue-100 border-blue-200' },
  custody_return: { label: 'إعادة عهدة', icon: RotateCcw, className: 'text-cyan-700 bg-cyan-100 border-cyan-200' },
  damage: { label: 'تلف', icon: FileWarning, className: 'text-red-700 bg-red-100 border-red-200' },
  central_return: { label: 'مرتجع مركزي', icon: RotateCcw, className: 'text-purple-700 bg-purple-100 border-purple-200' },
};

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '—';
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toLocaleString('ar');
}

function movementBadge(type: MovementType) {
  const meta = TYPE_META[type] ?? TYPE_META.adjust;
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn('gap-1 border text-xs', meta.className)}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </Badge>
  );
}

export function ItemDetailsPage({ itemId: providedItemId }: { itemId?: number } = {}) {
  const [, setLocation] = useLocation();
  const [, routeParams] = useRoute('/items/:id');
  const itemId = providedItemId ?? Number(routeParams?.id);
  const [type, setType] = useState<MovementType | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [document, setDocument] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItemHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const dateRangeError = from && to && from > to
    ? 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساوياً له'
    : '';

  useEffect(() => {
    setPage(1);
  }, [type, from, to, document]);

  useEffect(() => {
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      setIsLoading(false);
      setError('معرّف المادة غير صالح');
      return;
    }

    const controller = new AbortController();
    if (from && to && from > to) {
      setIsLoading(false);
      setError('');
      return;
    }
    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
    });
    if (type !== 'all') params.set('type', type);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (document.trim()) params.set('document', document.trim());

    setIsLoading(true);
    setError('');
    params.set('itemId', String(itemId));
    fetch(`/api/items/history?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('تعذر تحميل بطاقة المادة');
        return response.json() as Promise<ItemHistoryResponse>;
      })
      .then(setData)
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== 'AbortError') {
          setError('تعذر تحميل بطاقة المادة وسجل الحركة');
        }
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [itemId, type, from, to, document, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const hasFilters = type !== 'all' || Boolean(from || to || document);
  const stockState = useMemo(() => {
    if (!data) return null;
    if (data.item.currentStock <= data.item.minStock && data.item.minStock > 0) {
      return { label: 'دون الحد الأدنى', className: 'text-red-700 bg-red-100 border-red-200' };
    }
    return { label: 'ضمن الحد', className: 'text-emerald-700 bg-emerald-100 border-emerald-200' };
  }, [data]);

  if (isLoading && !data) {
    return (
      <div className="space-y-6" dir="rtl">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24" />)}</div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4" dir="rtl">
        <Button variant="ghost" onClick={() => setLocation('/items')} className="gap-2"><ArrowLeft className="h-4 w-4" /> العودة للمواد</Button>
        <Card><CardContent className="py-12 text-center text-destructive">{error || 'المادة غير موجودة'}</CardContent></Card>
      </div>
    );
  }

  const { item } = data;
  return (
    <div className="print-document space-y-6 print:space-y-3" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" onClick={() => setLocation('/items')} className="mb-2 -mr-3 gap-2 print:hidden">
            <ArrowLeft className="h-4 w-4" /> العودة للمواد
          </Button>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><Package className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{item.name}</h1>
               <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                 <span>بطاقة المادة</span>
                 {item.code && (
                   <span className="inline-flex items-center gap-1 font-mono" dir="ltr">
                     · {item.code}
                     <CopyButton value={item.code} label="رمز المادة" className="h-7 w-7 text-foreground" />
                   </span>
                 )}
                 <span>· سجل زمني من الأقدم إلى الأحدث</span>
               </div>
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={() => window.print()} className="gap-2 print:hidden">
          <Printer className="h-4 w-4" /> طباعة البطاقة
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الرصيد الحالي</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(item.currentStock)} <span className="text-sm font-normal">{item.unit}</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الحد الأدنى</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(item.minStock)}</p>{stockState && <Badge variant="outline" className={cn('mt-1 text-[10px]', stockState.className)}>{stockState.label}</Badge>}</CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الدفعات</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(data.batches.length)}</p><p className="text-xs text-muted-foreground">دفعة قابلة للتتبع</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الحركات المطابقة</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(data.total)}</p><p className="text-xs text-muted-foreground">{hasFilters ? 'بعد التصفية' : 'كل السجل'}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">بيانات المادة</CardTitle>
          <CardDescription>البيانات الحالية والحقول التاريخية التي تساعد على مطابقة الرصيد.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label="التصنيف" value={item.categoryName} />
          <Info label="الموقع" value={item.location} />
          <Info label="المورد" value={item.supplier} />
          <Info label="الصلاحية المختصرة" value={dateOnly(item.expiryDate)} />
          {item.notes && <Info label="ملاحظات" value={item.notes} className="sm:col-span-2 lg:col-span-4" />}
        </CardContent>
      </Card>

      <Card className="print:shadow-none">
        <CardHeader className="pb-4 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> سجل الحركة التاريخي</CardTitle>
              <CardDescription>كل حركة مرتبطة بهذه المادة فقط، مرتبة زمنيًا وقابلة للمراجعة.</CardDescription>
            </div>
            {isLoading && <span className="text-xs text-muted-foreground">جاري التحديث…</span>}
          </div>
          <div className="grid gap-3 pt-3 md:grid-cols-4">
            <div className="relative md:col-span-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={document} onChange={(event) => setDocument(event.target.value)} placeholder="بحث برقم المستند" className="pr-9" aria-label="بحث برقم المستند" />
            </div>
            <Select value={type} onValueChange={(value) => setType(value as MovementType | 'all')}>
              <SelectTrigger aria-label="تصفية نوع الحركة"><SelectValue placeholder="كل الحركات" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحركات</SelectItem>
                {Object.entries(TYPE_META).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="من تاريخ" />
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="إلى تاريخ" />
          </div>
          {dateRangeError && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {dateRangeError}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {data.movements.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-muted-foreground">لا توجد حركات مطابقة للفلاتر.</div>
            ) : data.movements.map((movement) => (
              <article key={movement.id} className="relative grid gap-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:px-6">
                <div className="flex items-center gap-2 sm:pt-1">{movementBadge(movement.type)}<span className="text-xs tabular-nums text-muted-foreground">{dateOnly(movement.documentDate)}</span></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                     <span className="inline-flex items-center gap-1 font-semibold">
                       {movement.documentNumber}
                       <CopyButton value={movement.documentNumber} label="رقم السند" className="h-7 w-7" />
                     </span>
                    {movement.isHistoricalIncomplete && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700">سجل تاريخي ناقص الحقول</Badge>}
                  </div>
                  <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>المنفذ: {movement.operatorName || 'غير متوفر'}</span>
                    <span>الجهة: {movement.partyName || 'غير محددة'}</span>
                     <span className="inline-flex items-center gap-1">
                       الدفعة: {movement.batchNumber || 'غير متوفر'}
                       {movement.batchNumber && <CopyButton value={movement.batchNumber} label="رقم الدفعة" className="h-7 w-7" />}
                     </span>
                    <span>الصلاحية: {dateOnly(movement.expiryDate)}</span>
                  </div>
                  {movement.allocations.length > 1 && <p className="mt-2 text-xs text-primary">تخصيص FEFO: {movement.allocations.map((allocation) => `${allocation.batchNumber || 'بلا رقم'} (${allocation.quantity})`).join('، ')}</p>}
                  {(movement.reason || movement.notes) && <p className="mt-2 text-xs text-muted-foreground">{movement.reason || movement.notes}</p>}
                </div>
                <div className="text-right sm:text-left">
                  <p className="text-lg font-bold tabular-nums">{formatNumber(movement.quantity)} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span></p>
                  <p className="text-[11px] text-muted-foreground">الحركة رقم {movement.id}</p>
                </div>
              </article>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm print:hidden">
              <span className="text-muted-foreground">صفحة {data.page} من {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>السابق</Button>
                <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>التالي</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">الدفعات والصلاحيات</CardTitle><CardDescription>الرصيد المفصل لكل دفعة كما هو محفوظ في سجل FEFO.</CardDescription></CardHeader>
        <CardContent>
           <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-b text-right text-xs text-muted-foreground"><th className="pb-3 font-medium">الدفعة</th><th className="pb-3 font-medium">الوارد</th><th className="pb-3 font-medium">المتبقي</th><th className="pb-3 font-medium">الصلاحية</th><th className="pb-3 font-medium">مذكرة الإدخال</th></tr></thead>
             <tbody className="divide-y">{data.batches.map((batch) => <tr key={batch.id}><td className="py-3 font-medium"><span className="inline-flex items-center gap-1">{batch.batchNumber || 'بلا رقم'}{batch.batchNumber && <CopyButton value={batch.batchNumber} label="رقم الدفعة" className="h-7 w-7" />}</span></td><td className="py-3 tabular-nums">{formatNumber(batch.receivedQuantity)}</td><td className="py-3 tabular-nums">{formatNumber(batch.remainingQuantity)}</td><td className="py-3">{dateOnly(batch.expiryDate)}</td><td className="py-3"><span className="inline-flex items-center gap-1">{batch.deliveryNoteNumber || '—'}{batch.deliveryNoteNumber && <CopyButton value={batch.deliveryNoteNumber} label="رقم مذكرة الإدخال" className="h-7 w-7" />}{batch.deliveryNoteDate ? ` · ${dateOnly(batch.deliveryNoteDate)}` : ''}</span></td></tr>)}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="hidden print:block print:text-xs">
        تمت طباعة البطاقة من مستودعات مديرية صحة دمشق — {new Date().toLocaleDateString('ar-SY')}
      </div>
    </div>
  );
}

function Info({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return <div className={className}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value || 'غير محدد'}</p></div>;
}