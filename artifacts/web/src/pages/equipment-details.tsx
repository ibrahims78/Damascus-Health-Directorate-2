import { useEffect, useState } from 'react';
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
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CopyButton } from '@/components/copy-button';

type MovementType = 'in' | 'init' | 'out' | 'adjust' | 'custody_out' | 'custody_return' | 'damage' | 'central_return';
type EquipmentHistory = {
  equipment: {
    id: number; name: string; equipmentType: string | null; model: string | null;
    serialNumber: string | null; condition: string; manufactureYear: number | null;
    originCountry: string | null; currentHolder: string | null; quantity: number;
    minQuantity: number; custodyQuantity: number; availableQuantity: number;
    notes: string | null; maintenanceSentAt: string | null; maintenanceReturnedAt: string | null;
    maintenanceNotes: string | null;
  };
  custodies: Array<{
    id: number; holderName: string; recipientName: string | null; quantity: number;
    returnedQuantity: number; outstandingQuantity: number; deliveryNoteNumber: string;
    deliveryDate: string; location: string; status: string;
  }>;
  movements: Array<{
    id: number; type: MovementType; quantity: number | null; partyName: string | null;
    holderName: string | null; documentNumber: string; documentDate: string | null;
    custodyNoteNumber: string | null; custodyDate: string | null; custodyLocation: string | null;
    reason: string | null; notes: string | null; createdAt: string | null; operatorName: string | null;
  }>;
  total: number;
};

const CONDITION_META: Record<string, { label: string; className: string }> = {
  good: { label: 'جيد', className: 'border-emerald-200 bg-emerald-100 text-emerald-700' },
  maintenance: { label: 'تحت الصيانة', className: 'border-blue-200 bg-blue-100 text-blue-700' },
  broken: { label: 'معطل', className: 'border-red-200 bg-red-100 text-red-700' },
  consumed: { label: 'مستهلك', className: 'border-zinc-200 bg-zinc-100 text-zinc-600' },
  needs_inspection: { label: 'يحتاج فحص', className: 'border-amber-200 bg-amber-100 text-amber-700' },
};

const MOVEMENT_META: Record<MovementType, { label: string; icon: typeof ArrowDownToLine; className: string }> = {
  in: { label: 'إدخال', icon: ArrowDownToLine, className: 'text-emerald-700 bg-emerald-100 border-emerald-200' },
  init: { label: 'إدخال افتتاحي', icon: ArrowDownToLine, className: 'text-teal-700 bg-teal-100 border-teal-200' },
  out: { label: 'إخراج', icon: ArrowUpFromLine, className: 'text-red-700 bg-red-100 border-red-200' },
  adjust: { label: 'تسوية جرد', icon: ClipboardList, className: 'text-amber-700 bg-amber-100 border-amber-200' },
  custody_out: { label: 'تسليم عهدة', icon: ShieldCheck, className: 'text-blue-700 bg-blue-100 border-blue-200' },
  custody_return: { label: 'إعادة عهدة', icon: RotateCcw, className: 'text-cyan-700 bg-cyan-100 border-cyan-200' },
  damage: { label: 'تلف', icon: FileWarning, className: 'text-red-700 bg-red-100 border-red-200' },
  central_return: { label: 'مرتجع مركزي', icon: RotateCcw, className: 'text-purple-700 bg-purple-100 border-purple-200' },
};

function dateOnly(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : '—';
}

function number(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toLocaleString('ar');
}

function Info({ label, value, className }: { label: string; value: string | number | null | undefined; className?: string }) {
  const hasValue = value !== null && value !== undefined && value !== '';
  return <div className={className}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{hasValue ? value : 'غير محدد'}</p></div>;
}

export function EquipmentDetailsPage({ equipmentId: providedId }: { equipmentId?: number } = {}) {
  const [, params] = useRoute('/equipment/:id');
  const [, setLocation] = useLocation();
  const equipmentId = providedId ?? Number(params?.id);
  const [data, setData] = useState<EquipmentHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [type, setType] = useState<MovementType | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [document, setDocument] = useState('');

  useEffect(() => {
    if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0) {
      setError('معرّف التجهيز غير صالح');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (type !== 'all') query.set('type', type);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (document.trim()) query.set('document', document.trim());
    setLoading(true);
    fetch(`/api/equipment/${equipmentId}/history${query.toString() ? `?${query}` : ''}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('تعذر تحميل بطاقة التجهيز');
        return response.json() as Promise<EquipmentHistory>;
      })
      .then((result) => { setData(result); setError(''); })
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== 'AbortError') setError('تعذر تحميل بطاقة التجهيز وسجل الحركة');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [equipmentId, type, from, to, document]);

  if (loading && !data) {
    return <div className="space-y-6" dir="rtl"><Skeleton className="h-10 w-72" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-96 w-full" /></div>;
  }
  if (error || !data) {
    return <div className="space-y-4" dir="rtl"><Button variant="ghost" onClick={() => setLocation('/equipment')} className="gap-2"><ArrowLeft className="h-4 w-4" /> العودة للتجهيزات</Button><Card><CardContent className="py-12 text-center text-destructive">{error || 'التجهيز غير موجود'}</CardContent></Card></div>;
  }

  const { equipment } = data;
  const condition = CONDITION_META[equipment.condition] ?? { label: equipment.condition, className: '' };
  return (
    <div className="print-document space-y-6 print:space-y-3" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" onClick={() => setLocation('/equipment')} className="mb-2 -mr-3 gap-2 print:hidden"><ArrowLeft className="h-4 w-4" /> العودة للتجهيزات</Button>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary"><Wrench className="h-6 w-6" /></div>
            <div><h1 className="text-2xl font-bold tracking-tight">{equipment.name}</h1><p className="mt-1 text-sm text-muted-foreground">بطاقة التجهيز وسجل حركاته المرتبط بالعهد والوثائق</p></div>
          </div>
        </div>
        <Button variant="outline" onClick={() => window.print()} className="gap-2 print:hidden"><Printer className="h-4 w-4" /> طباعة البطاقة</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn('border text-xs', condition.className)}>{condition.label}</Badge>
        {equipment.serialNumber && <Badge variant="outline" className="font-mono text-xs">S/N: {equipment.serialNumber}</Badge>}
        {equipment.model && <Badge variant="outline" className="text-xs">{equipment.model}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الكمية الإجمالية</p><p className="mt-1 text-2xl font-bold tabular-nums">{number(equipment.quantity)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المتاحة حالياً</p><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{number(equipment.availableQuantity)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">على العهدة</p><p className="mt-1 text-2xl font-bold tabular-nums text-blue-600">{number(equipment.custodyQuantity)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">الحركات المسجلة</p><p className="mt-1 text-2xl font-bold tabular-nums">{number(data.total)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-base">بيانات التجهيز</CardTitle><CardDescription>البيانات الحالية والحقول التي تساعد على التعرف الدقيق على الوحدة.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label="النوع" value={equipment.equipmentType} /><Info label="الموديل" value={equipment.model} />
           <div><p className="text-xs text-muted-foreground">الرقم التسلسلي</p><div className="mt-1 flex items-center gap-1"><p className="font-medium font-mono">{equipment.serialNumber || 'غير محدد'}</p><CopyButton value={equipment.serialNumber} label="الرقم التسلسلي" /></div></div><Info label="سنة الصنع" value={equipment.manufactureYear} />
          <Info label="بلد المنشأ" value={equipment.originCountry} /><Info label="الحائز الحالي" value={equipment.currentHolder} />
          <Info label="الحالة" value={condition.label} /><Info label="حد التنبيه" value={equipment.minQuantity} />
          {equipment.maintenanceSentAt && <Info label="بيانات الصيانة" value={`${dateOnly(equipment.maintenanceSentAt)}${equipment.maintenanceReturnedAt ? ` — عودة ${dateOnly(equipment.maintenanceReturnedAt)}` : ''}`} className="sm:col-span-2" />}
           {equipment.maintenanceNotes && <Info label="ملاحظات الصيانة" value={equipment.maintenanceNotes} className="sm:col-span-2 lg:col-span-2" />}
           {equipment.notes && <Info label="الملاحظات" value={equipment.notes} className="sm:col-span-2 lg:col-span-2" />}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="pb-4"><CardTitle className="text-base">العهد المرتبطة بهذا التجهيز</CardTitle><CardDescription>كل سجل عهدة مستقل، ويمكن فتح بطاقة العهدة وسجل الإعادة والتلف منه.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {data.custodies.length === 0 ? <div className="px-6 py-10 text-center text-sm text-muted-foreground">لا توجد عهد مرتبطة بهذا التجهيز.</div> : (
            <div className="divide-y">
              {data.custodies.map((custody) => (
                <Link key={custody.id} href={`/custodies/${custody.id}`} className="flex flex-col gap-2 px-6 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-semibold text-primary hover:underline">{custody.holderName}</p><p className="mt-1 text-xs text-muted-foreground">{custody.deliveryNoteNumber} · {dateOnly(custody.deliveryDate)} · {custody.location}</p></div>
                  <div className="flex items-center gap-3 text-sm"><span className="tabular-nums">{number(custody.outstandingQuantity)} متبقٍ من {number(custody.quantity)}</span><Badge variant="outline" className="text-xs">{custody.status === 'partially_returned' ? 'إعادة جزئية' : custody.status === 'returned' ? 'معادة بالكامل' : custody.status === 'damaged' ? 'تالفة' : 'مفتوحة'}</Badge></div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="print:shadow-none">
        <CardHeader className="pb-4 print:hidden">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> سجل الحركة الزمني</CardTitle><CardDescription>إدخال وتسليم وإعادة وتلف ومرتجع وتسويات هذا التجهيز فقط.</CardDescription></div>{loading && <span className="text-xs text-muted-foreground">جاري التحديث…</span>}</div>
           <div className="grid gap-3 pt-3 md:grid-cols-2 lg:grid-cols-4"><div className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={document} onChange={(event) => setDocument(event.target.value)} placeholder="بحث برقم المستند" className="pr-9" aria-label="بحث برقم المستند" /></div><Select value={type} onValueChange={(value) => setType(value as MovementType | 'all')}><SelectTrigger aria-label="تصفية نوع الحركة"><SelectValue placeholder="كل الحركات" /></SelectTrigger><SelectContent><SelectItem value="all">كل الحركات</SelectItem>{Object.entries(MOVEMENT_META).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}</SelectContent></Select><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="من تاريخ" /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="إلى تاريخ" /></div>
        </CardHeader>
        <CardContent className="p-0">
          {data.movements.length === 0 ? <div className="px-6 py-14 text-center text-sm text-muted-foreground">لا توجد حركات مطابقة للفلاتر.</div> : <div className="divide-y">{data.movements.map((movement) => { const meta = MOVEMENT_META[movement.type] ?? MOVEMENT_META.adjust; const Icon = meta.icon; return <article key={movement.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:px-6"><div className="flex items-center gap-2 sm:pt-1"><Badge variant="outline" className={cn('gap-1 border text-xs', meta.className)}><Icon className="h-3.5 w-3.5" />{meta.label}</Badge><span className="text-xs tabular-nums text-muted-foreground">{dateOnly(movement.documentDate)}</span></div><div><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold">{movement.documentNumber}</span>{movement.custodyNoteNumber && <span className="text-xs text-muted-foreground">مذكرة عهدة: {movement.custodyNoteNumber}</span>}</div><div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2"><span>المنفذ: {movement.operatorName || 'غير متوفر'}</span><span>الحائز/الجهة: {movement.holderName || movement.partyName || 'غير محددة'}</span><span>المكان: {movement.custodyLocation || 'غير محدد'}</span><span>الحركة رقم: {movement.id}</span></div>{(movement.reason || movement.notes) && <p className="mt-2 text-xs text-muted-foreground">{movement.reason || movement.notes}</p>}{movement.type === 'adjust' && (movement as { details?: Record<string, unknown> | null }).details && (() => { const d = (movement as { details?: Record<string, unknown> }).details!; const prev = d.previousStock; const next = d.newStock; if (prev === undefined || next === undefined) return null; return <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">الرصيد قبل: {String(prev)} ← بعد: {String(next)}</p>; })()}</div><div className="text-right sm:text-left"><p className="text-lg font-bold tabular-nums">{number(movement.quantity)}</p><p className="text-[11px] text-muted-foreground">الكمية</p></div></article>; })}</div>}
        </CardContent>
      </Card>
      <div className="hidden print:block print:text-xs">تمت طباعة بطاقة التجهيز من مستودعات مديرية صحة دمشق — {new Date().toLocaleDateString('ar-SY')}</div>
    </div>
  );
}