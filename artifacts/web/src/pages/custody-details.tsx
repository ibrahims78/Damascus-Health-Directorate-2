import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowLeft, ClipboardCheck, FileWarning, History, Printer, RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/copy-button';

type CustodyDetails = {
  custody: {
    id: number; equipmentId: number; holderName: string; recipientName: string | null;
    quantity: number; returnedQuantity: number; outstandingQuantity: number;
    deliveryNoteNumber: string; deliveryDate: string; location: string; status: string;
    isOverdue: boolean; daysHeld: number;
  };
  equipment: { id: number; name: string; equipmentType: string | null; model: string | null; serialNumber: string | null };
  returns: Array<{ id: number; quantity: number; returnDate: string; documentNumber: string; condition: string; returnedToLocation: string; inspectionNotes: string | null; operatorName: string | null }>;
  events: Array<{ id: string; kind: string; label: string; date: string; quantity: number; documentNumber: string; location: string; condition: string | null; notes: string | null; operatorName: string | null }>;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: 'مفتوحة', className: 'border-blue-200 bg-blue-100 text-blue-700' },
  partially_returned: { label: 'معادة جزئياً', className: 'border-amber-200 bg-amber-100 text-amber-700' },
  returned: { label: 'معادة بالكامل', className: 'border-emerald-200 bg-emerald-100 text-emerald-700' },
  damaged: { label: 'تالفة', className: 'border-red-200 bg-red-100 text-red-700' },
  closed: { label: 'مغلقة', className: 'border-zinc-200 bg-zinc-100 text-zinc-600' },
};

const CONDITION_LABELS: Record<string, string> = { good: 'جيد', damaged: 'تالف', needs_maintenance: 'يحتاج صيانة', missing: 'مفقود' };
const formatNumber = (value: number) => value.toLocaleString('ar');
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10) : '—';

export function CustodyDetailsPage({ custodyId: providedId }: { custodyId?: number } = {}) {
  const [, params] = useRoute('/custodies/:id');
  const [, setLocation] = useLocation();
  const custodyId = providedId ?? Number(params?.id);
  const [data, setData] = useState<CustodyDetails | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!Number.isSafeInteger(custodyId) || custodyId <= 0) { setError('معرّف العهدة غير صالح'); return; }
    const controller = new AbortController();
    fetch(`/api/custodies/${custodyId}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error('تعذر تحميل بطاقة العهدة'); return response.json() as Promise<CustodyDetails>; })
      .then(setData)
      .catch((reason: unknown) => { if ((reason as { name?: string })?.name !== 'AbortError') setError('تعذر تحميل بطاقة العهدة وسجلها'); });
    return () => controller.abort();
  }, [custodyId]);

  if (!data && !error) return <div className="space-y-6" dir="rtl"><Skeleton className="h-10 w-72" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-96 w-full" /></div>;
  if (error || !data) return <div className="space-y-4" dir="rtl"><Button variant="ghost" onClick={() => setLocation('/reports?tab=custodies')} className="gap-2"><ArrowLeft className="h-4 w-4" /> العودة للعهد</Button><Card><CardContent className="py-12 text-center text-destructive">{error || 'العهدة غير موجودة'}</CardContent></Card></div>;

  const { custody, equipment } = data;
  const status = STATUS_META[custody.status] ?? { label: custody.status, className: '' };
  return (
    <div className="print-document space-y-6 print:space-y-3" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" onClick={() => setLocation('/reports?tab=custodies')} className="mb-2 -mr-3 gap-2 print:hidden"><ArrowLeft className="h-4 w-4" /> العودة للعهد</Button>
          <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-100 p-3 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"><ShieldCheck className="h-6 w-6" /></div><div><div className="flex items-center gap-1"><h1 className="text-2xl font-bold tracking-tight">عهدة رقم {custody.id}</h1><CopyButton value={String(custody.id)} label="رقم العهدة" /></div><p className="mt-1 text-sm text-muted-foreground">بطاقة دورة حياة العهدة وسجل التسليم والإعادة والفحص</p></div></div>
        </div>
         <div className="flex flex-wrap gap-2 print:hidden">
           {custody.outstandingQuantity > 0 && (
             <Button variant="default" onClick={() => setLocation(`/custody/return/new?custodyId=${custody.id}`)} className="gap-2">
               <RotateCcw className="h-4 w-4" /> إعادة العهدة
             </Button>
           )}
           <Button variant="outline" onClick={() => window.print()} className="gap-2"><Printer className="h-4 w-4" /> طباعة سند التسليم / الإعادة</Button>
         </div>
      </div>

      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={cn('border text-xs', status.className)}>{status.label}</Badge>{custody.isOverdue && <Badge variant="destructive" className="text-xs">متأخرة ({custody.daysHeld} يوم)</Badge>}<Link href={`/equipment/${equipment.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">فتح بطاقة التجهيز: {equipment.name}</Link></div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الكمية المسلّمة</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(custody.quantity)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المعادة</p><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{formatNumber(custody.returnedQuantity)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المتبقية</p><p className="mt-1 text-2xl font-bold tabular-nums text-amber-600">{formatNumber(custody.outstandingQuantity)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">مدة البقاء</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(custody.daysHeld)} <span className="text-sm font-normal">يوم</span></p></CardContent></Card>
      </div>

      <Card><CardHeader className="pb-4"><CardTitle className="text-base">بيانات العهدة والتجهيز</CardTitle><CardDescription>لقطات مستقلة محفوظة مع سند التسليم، مع رابط مباشر للتجهيز الأصلي.</CardDescription></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">التجهيز</p><Link href={`/equipment/${equipment.id}`} className="mt-1 block font-medium text-primary hover:underline">{equipment.name}</Link><p className="text-xs text-muted-foreground">{[equipment.equipmentType, equipment.model, equipment.serialNumber].filter(Boolean).join(' · ') || 'بيانات تعريف غير مكتملة'}</p></div>
        <Info label="الحائز" value={custody.holderName} /><Info label="الجهة / الشخص المستلم" value={custody.recipientName} /><Info label="موقع العهدة" value={custody.location} />
         <div><p className="text-xs text-muted-foreground">رقم مذكرة التسليم</p><div className="mt-1 flex items-center gap-1"><p className="font-medium">{custody.deliveryNoteNumber || 'غير محدد'}</p><CopyButton value={custody.deliveryNoteNumber} label="رقم مذكرة التسليم" /></div></div><Info label="تاريخ التسليم" value={dateOnly(custody.deliveryDate)} /><Info label="تاريخ الإعادة الأخير" value={dateOnly(data.returns.at(-1)?.returnDate)} /><Info label="الحالة" value={status.label} />
      </CardContent></Card>

      <Card className="print:hidden">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-primary" /> تفاصيل الإعادات والفحص</CardTitle>
          <CardDescription>تفاصيل كل إعادة مسجلة، بما فيها الكمية والحالة وملاحظات الفحص والجهة المنفذ إليها.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.returns.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">لم تسجل إعادة لهذه العهدة بعد.</div>
          ) : (
            <div className="divide-y">
              {data.returns.map((returned) => (
                <div key={returned.id} className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-start sm:px-6">
                  <div>
                    <div className="flex items-center gap-1"><p className="font-semibold">{returned.documentNumber}</p><CopyButton value={returned.documentNumber} label="رقم سند الإعادة" /></div>
                    <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>تاريخ الإعادة: {dateOnly(returned.returnDate)}</span>
                      <span>المكان: {returned.returnedToLocation || 'غير محدد'}</span>
                      <span>الفحص: {CONDITION_LABELS[returned.condition] ?? returned.condition}</span>
                      <span>المنفذ: {returned.operatorName || 'غير متوفر'}</span>
                    </div>
                    {returned.inspectionNotes && <p className="mt-2 text-xs text-muted-foreground">{returned.inspectionNotes}</p>}
                  </div>
                  <Badge variant="outline" className="h-fit border-cyan-200 bg-cyan-100 text-cyan-700">{returned.condition === 'damaged' ? 'تالف' : 'معاد'}</Badge>
                  <div className="text-left sm:text-right"><p className="text-lg font-bold tabular-nums">{formatNumber(returned.quantity)}</p><p className="text-[11px] text-muted-foreground">الكمية</p></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="print:shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> سجل دورة الحياة</CardTitle>
          <CardDescription>سجل غير قابل للتعديل لإنشاء العهدة والإعادات والتلف ونتائج الفحص.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {data.events.map((event) => {
              const EventIcon = event.kind === 'damaged' ? FileWarning : event.kind === 'returned' ? RotateCcw : ShieldCheck;
              return (
                <article key={event.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:px-6">
                  <div className="flex items-center gap-2 sm:pt-1">
                    <Badge variant="outline" className={cn('gap-1 border text-xs', event.kind === 'damaged' ? 'border-red-200 bg-red-100 text-red-700' : event.kind === 'returned' ? 'border-cyan-200 bg-cyan-100 text-cyan-700' : 'border-blue-200 bg-blue-100 text-blue-700')}>
                      <EventIcon className="h-3.5 w-3.5" />{event.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{dateOnly(event.date)}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1"><p className="font-semibold">{event.documentNumber}</p><CopyButton value={event.documentNumber} label="رقم السند" /></div>
                    <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>المنفذ: {event.operatorName || 'غير متوفر'}</span>
                      <span>المكان: {event.location || 'غير محدد'}</span>
                      <span>الكمية: {formatNumber(event.quantity)}</span>
                      <span>الفحص: {event.condition ? CONDITION_LABELS[event.condition] ?? event.condition : 'غير مسجل'}</span>
                    </div>
                    {event.notes && <p className="mt-2 text-xs text-muted-foreground">{event.notes}</p>}
                  </div>
                  <div className="text-xs text-muted-foreground">سجل {event.id}</div>
                </article>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="hidden print:block print:text-xs">تمت طباعة بطاقة العهدة من مستودعات مديرية صحة دمشق — {new Date().toLocaleDateString('ar-SY')}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value || 'غير محدد'}</p></div>;
}