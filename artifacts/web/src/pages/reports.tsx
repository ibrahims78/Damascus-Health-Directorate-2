import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  useGetStockReport,
  useGetMovementsReport,
  useGetExpiryReport,
  useGetNearExpiryReport,
  useGetStagnantItemsReport,
  useGetBelowMinReport,
  useGetEquipmentReport,
  useGetStockPositionReport,
  useGetCustodiesReport,
  type Item,
  type Transaction,
  type Equipment,
  type StockPositionItem,
  type StockPositionEquipment,
  type CustodyReportRecord,
  type StagnantItem,
} from '@workspace/api-client-react';
import {
  Printer,
  Download,
  RotateCcw,
  PackageSearch,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  Stethoscope,
  ExternalLink,
  Boxes,
  UserRoundCheck,
  Clock,
  Archive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, formatDate } from '@/lib/utils';
import { isValidIsoDate } from '@/lib/inventory-validation';
import { toast } from '@/hooks/use-toast';
import logoUrl from '@assets/damascus-health-directorate-logo.png';
import { Capacitor } from '@capacitor/core';
import { nativeFileActions } from '@/lib/native-file-actions';

// ─── helpers ───────────────────────────────────────────────────────────────

type ExcelCell = string | number | boolean | null;

function exportFilename(baseName: string, qualifier?: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `${baseName}${qualifier ? `-${qualifier}` : ''}-${date}.xlsx`;
}

function dateRangeFilename(from: string, to: string) {
  if (!from && !to) return undefined;
  return `من-${from || 'البداية'}-إلى-${to || 'اليوم'}`;
}

async function fetchReportSettings(): Promise<{ expiryAlertDays: number }> {
  const response = await fetch('/api/settings', { credentials: 'include' });
  if (!response.ok) throw new Error('تعذر جلب إعدادات التقارير');
  return response.json() as Promise<{ expiryAlertDays: number }>;
}

function columnName(index: number) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

async function printCurrentPage() {
  if (Capacitor.isNativePlatform()) {
    try {
      await nativeFileActions.print({ title: 'تقرير مستودعات مديرية صحة دمشق' });
      return;
    } catch (error) {
      console.error('Native print failed, falling back to browser print:', error);
    }
  }

  // Keep this call in the button's click stack for regular browsers.
  window.focus();
  window.print();
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function downloadBlob(blob: Blob, filename: string): Promise<string | undefined> {
  if (Capacitor.isNativePlatform()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = await nativeFileActions.saveFile({ filename, base64: bytesToBase64(bytes) });
    if (!saved?.uri) {
      throw new Error('Native file plugin did not return a saved file URI');
    }
    return saved.location;
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return undefined;
}

async function exportXlsx(filename: string, headers: string[], rows: ExcelCell[][]) {
  if (rows.length === 0) {
    toast({ description: 'لا توجد بيانات لتصديرها' });
    return;
  }

  try {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((header, index) => {
      const longestValue = rows.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), header.length);
      return { wch: Math.min(42, Math.max(14, longestValue + 2)) };
    });
    ws['!autofilter'] = { ref: `A1:${columnName(headers.length - 1)}${rows.length + 1}` };
    ws['!views'] = [{ RTL: true }];
    const wb = XLSX.utils.book_new();
    wb.Props = {
      Title: filename.replace(/\.xlsx$/i, ''),
      Subject: 'تقرير مستودعات مديرية صحة دمشق',
      Author: 'مستودعات مديرية صحة دمشق',
      CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(wb, ws, 'البيانات');
    const workbookBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const location = await downloadBlob(
      new Blob([workbookBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    );
    toast({
      description: location
        ? `تم حفظ ملف Excel في مجلد Download/مستودعات مديرية صحة دمشق`
        : `تم تنزيل ملف Excel (${rows.length.toLocaleString('ar')} سجل) بنجاح`,
    });
  } catch (error) {
    console.error('Report export failed:', error);
    toast({ variant: 'destructive', description: 'تعذر إنشاء ملف Excel. حاول مرة أخرى' });
  }
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'warning' | 'danger' | 'success';
}) {
  const color =
    accent === 'danger'
      ? 'text-destructive'
      : accent === 'warning'
        ? 'text-warning'
        : accent === 'success'
          ? 'text-success'
          : 'text-foreground';
  return (
    <div className="bg-card border rounded-lg p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={99} className="h-32 text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

function ReportErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={99} className="p-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
          <div>تعذر تحميل بيانات التقرير. تحقق من اتصال الخادم ثم أعد المحاولة.</div>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" className="mt-3 gap-2" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" />إعادة المحاولة
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PrintHeader({ title }: { title: string }) {
  return (
    <div className="hidden print:block mb-6 text-center border-b-2 border-[#1e3a5f] pb-4">
      <img
        src={logoUrl}
        alt="شعار مستودعات مديرية صحة دمشق"
        className="mx-auto mb-2 h-20 w-20 object-contain"
      />
      <div className="text-xs text-muted-foreground">الجمهورية العربية السورية — وزارة الصحة</div>
      <div className="text-lg font-bold text-[#1e3a5f]">مستودعات مديرية صحة دمشق</div>
      <div className="text-base font-semibold mt-1">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">
        تاريخ الطباعة: {new Date().toLocaleDateString('ar-SY')}
      </div>
    </div>
  );
}

// ─── condition map ──────────────────────────────────────────────────────────

const conditionMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  good: { label: 'جيدة', variant: 'default' },
  maintenance: { label: 'صيانة', variant: 'secondary' },
  broken: { label: 'معطلة', variant: 'destructive' },
  consumed: { label: 'مستهلكة', variant: 'outline' },
  needs_inspection: { label: 'تحتاج فحص', variant: 'secondary' },
};

function transactionTypeLabel(type: string) {
  return {
    in: 'إدخال',
    out: 'إخراج',
    init: 'رصيد افتتاحي',
    adjust: 'تسوية جرد',
    custody_out: 'إخراج عهدة',
    custody_return: 'إعادة عهدة',
    damage: 'إتلاف',
    central_return: 'مرتجع مركزي',
  }[type] ?? type;
}

// ─── tab 1: stock ───────────────────────────────────────────────────────────

function StockTab() {
  const { data, isLoading, isError, refetch } = useGetStockReport();
  const { data: settings } = useQuery({
    queryKey: ['settings', 'reports'],
    queryFn: fetchReportSettings,
    staleTime: 5 * 60 * 1000,
  });
  const items = data ?? [];
  const expiryAlertDays = settings?.expiryAlertDays ?? 30;

  const totalItems = items.length;
  const totalStock = items.reduce((s, i) => s + i.currentStock, 0);
  const belowMin = items.filter((i) => i.currentStock <= i.minStock).length;

  const handleExport = async () => {
    await exportXlsx(
      exportFilename('تقرير-جرد-المخزون'),
      ['الكود', 'الاسم', 'التصنيف', 'الرصيد الحالي', 'الحد الأدنى', 'الوحدة', 'تاريخ الانتهاء', 'الموقع', 'الحالة'],
      items.map((i: Item) => [
        i.code ?? '',
        i.name,
        i.categoryName ?? '',
        i.currentStock,
        i.minStock,
        i.unit,
        i.expiryDate ? formatDate(i.expiryDate) : '',
        i.location ?? '',
         i.currentStock <= i.minStock
           ? 'نقص'
           : i.expiryDate &&
               (new Date(i.expiryDate).getTime() - Date.now()) / 86400000 <= expiryAlertDays
             ? 'قرب انتهاء'
             : 'طبيعي',
      ]),
    );
  };

  return (
    <>
      <PrintHeader title="تقرير جرد المخزون" />
      <div className="grid grid-cols-3 gap-4 mb-6 print:grid">
        <SummaryCard label="إجمالي الأصناف" value={totalItems} />
        <SummaryCard label="إجمالي الوحدات" value={totalStock.toLocaleString('ar')} />
        <SummaryCard label="أقل من الحد الأدنى" value={belowMin} accent={belowMin > 0 ? 'danger' : 'success'} />
      </div>

      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />
          طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />
          تصدير Excel
        </Button>
      </div>

      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">الكود</TableHead>
              <TableHead className="text-right">اسم المادة</TableHead>
              <TableHead className="text-right">التصنيف</TableHead>
              <TableHead className="text-center">الرصيد الحالي</TableHead>
              <TableHead className="text-center">الحد الأدنى</TableHead>
              <TableHead className="text-right">الوحدة</TableHead>
              <TableHead className="text-center">تاريخ الانتهاء</TableHead>
              <TableHead className="text-right print:hidden">الموقع</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <EmptyState message="لا توجد مواد مسجّلة بعد" />
            ) : (
              items.map((item: Item) => {
                const isBelowMin = item.currentStock <= item.minStock;
                const isNearExpiry =
                  item.expiryDate
                   ? (new Date(item.expiryDate).getTime() - Date.now()) / 86400000 <= expiryAlertDays
                    : false;
                return (
                  <TableRow key={item.id} className={isBelowMin ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.code ?? '—'}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{item.categoryName ?? '—'}</TableCell>
                    <TableCell className={`text-center font-bold ${isBelowMin ? 'text-destructive' : ''}`}>
                      {item.currentStock.toLocaleString('ar')}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{item.minStock.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-sm">{item.unit}</TableCell>
                    <TableCell className={`text-center text-sm ${isNearExpiry ? 'text-warning font-medium' : ''}`}>
                      {item.expiryDate ? formatDate(item.expiryDate) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground print:hidden">{item.location ?? '—'}</TableCell>
                    <TableCell className="text-center">
                      {isBelowMin ? (
                        <Badge variant="destructive" className="text-xs">نقص</Badge>
                      ) : isNearExpiry ? (
                        <Badge className="bg-warning/15 text-warning border-warning/30 border text-xs">قرب انتهاء</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">طبيعي</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── tab 2: movements ───────────────────────────────────────────────────────

function MovementsTab() {
  const initialParams = new URLSearchParams(window.location.search);
  const [from, setFrom] = useState(initialParams.get('from') ?? '');
  const [to, setTo] = useState(initialParams.get('to') ?? '');
  const [type, setType] = useState<'all' | 'in' | 'out'>(
    (initialParams.get('movementType') as 'all' | 'in' | 'out') || 'all',
  );
  const dateError = from && !isValidIsoDate(from)
    ? 'تاريخ البداية غير صالح'
    : to && !isValidIsoDate(to)
      ? 'تاريخ النهاية غير صالح'
      : from && to && from > to
        ? 'يجب أن يسبق تاريخ البداية تاريخ النهاية'
        : '';

  const { data, isLoading, isError, refetch } = useGetMovementsReport(
    {
      from: from || undefined,
      to: to || undefined,
      type: type === 'all' ? undefined : type,
    },
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (from) params.set('from', from); else params.delete('from');
    if (to) params.set('to', to); else params.delete('to');
    if (type !== 'all') params.set('movementType', type); else params.delete('movementType');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [from, to, type]);
  const txs = data ?? [];

  const countIn = txs.filter((t) => t.type === 'in').length;
  const countOut = txs.filter((t) => t.type === 'out').length;
  const countOther = txs.length - countIn - countOut;

  const hasFilters = from !== '' || to !== '' || type !== 'all';

  const handleExport = async () => {
    await exportXlsx(
       exportFilename('تقرير-حركة-المواد', dateRangeFilename(from, to)),
      ['رقم السند', 'التاريخ', 'النوع', 'الصنف', 'الكمية', 'الجهة المستلمة', 'اسم المستلم', 'سبب العملية', 'المستخدم'],
      txs.map((t: Transaction) => [
        t.documentNumber ?? '',
        formatDateTime(t.createdAt),
        transactionTypeLabel(t.type),
        t.itemType === 'equipment' ? (t.equipmentName ?? '') : (t.itemName ?? ''),
        t.quantity ?? null,
        t.recipientName ?? '',
        t.recipientPerson ?? '',
        t.exitReason ?? '',
        t.createdByName ?? '',
      ]),
    );
  };

  return (
    <>
      <PrintHeader title="تقرير حركة المواد" />

      {/* Filters */}
      <div className="bg-card border rounded-lg p-4 mb-4 print:hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">من تاريخ</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">إلى تاريخ</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">نوع العملية</label>
            <Select value={type} onValueChange={(v) => setType(v as 'all' | 'in' | 'out')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="in">إدخال فقط</SelectItem>
                <SelectItem value="out">إخراج فقط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            {hasFilters && (
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground"
                onClick={() => { setFrom(''); setTo(''); setType('all'); }}>
                <RotateCcw className="w-3.5 h-3.5" />
                إعادة ضبط
              </Button>
            )}
          </div>
        </div>
        {dateError && <p className="mt-3 text-sm text-destructive">{dateError}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 print:grid">
        <SummaryCard label="إجمالي العمليات" value={txs.length} />
        <SummaryCard label="عمليات إدخال" value={countIn} accent="success" />
        <SummaryCard label="عمليات إخراج" value={countOut} accent="danger" />
        <SummaryCard label="عمليات أخرى" value={countOther} />
      </div>
      <div className="hidden print:block text-xs text-muted-foreground mb-3">
        الفلاتر: من {from || 'البداية'} إلى {to || 'اليوم'} · النوع: {type === 'all' ? 'كل العمليات' : transactionTypeLabel(type)}
      </div>

      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>

      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">رقم السند</TableHead>
              <TableHead className="text-right">التاريخ</TableHead>
              <TableHead className="text-center">النوع</TableHead>
              <TableHead className="text-right">الصنف</TableHead>
              <TableHead className="text-center">الكمية</TableHead>
              <TableHead className="text-right">الجهة المستلمة</TableHead>
              <TableHead className="text-right">اسم المستلم</TableHead>
              <TableHead className="text-right">سبب العملية</TableHead>
              <TableHead className="text-right print:hidden">المستخدم</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dateError ? (
              <TableRow><TableCell colSpan={9} className="h-32 text-center text-destructive">{dateError}</TableCell></TableRow>
            ) : isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
            ) : txs.length === 0 ? (
              <EmptyState message={hasFilters ? 'لا توجد عمليات بهذه الفلاتر' : 'لا توجد عمليات مسجّلة بعد'} />
            ) : (
              txs.map((tx: Transaction) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono text-xs">{tx.documentNumber ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(tx.createdAt)}</TableCell>
                  <TableCell className="text-center">
                    {tx.type === 'in' ? (
                      <Badge className="bg-success/15 text-success border-success/30 border text-xs">إدخال</Badge>
                    ) : tx.type === 'out' ? (
                      <Badge variant="destructive" className="text-xs">إخراج</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">{transactionTypeLabel(tx.type)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {tx.itemType === 'equipment' ? tx.equipmentName : tx.itemName}
                    {tx.itemUnit && <span className="text-muted-foreground text-xs mr-1">({tx.itemUnit})</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {tx.quantity != null ? tx.quantity.toLocaleString('ar') : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{tx.recipientName ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {tx.recipientPerson ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {tx.exitReason ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground print:hidden">{tx.createdByName ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── tab 3: expiry ──────────────────────────────────────────────────────────

function ExpiryTab({ onlyNear = false }: { onlyNear?: boolean }) {
  const allExpiryQuery = useGetExpiryReport();
  const nearExpiryQuery = useGetNearExpiryReport();
  const data = onlyNear ? nearExpiryQuery.data : allExpiryQuery.data;
  const isLoading = onlyNear ? nearExpiryQuery.isLoading : allExpiryQuery.isLoading;
  const isError = onlyNear ? nearExpiryQuery.isError : allExpiryQuery.isError;
  const refetch = onlyNear ? nearExpiryQuery.refetch : allExpiryQuery.refetch;
  const items = data ?? [];

  const expired = items.filter(
    (i) => i.expiryDate && new Date(i.expiryDate) < new Date(),
  ).length;
  const nearExpiry = onlyNear ? items.length : items.length - expired;

  const handleExport = async () => {
    await exportXlsx(
      exportFilename(onlyNear ? 'تقرير-قرب-انتهاء-الصلاحية' : 'تقرير-الصلاحية'),
      ['الاسم', 'الرصيد', 'الوحدة', 'تاريخ الانتهاء', 'الأيام المتبقية'],
      items.map((i: Item) => {
        const days = i.expiryDate
          ? Math.ceil((new Date(i.expiryDate).getTime() - Date.now()) / 86400000)
          : 0;
        return [i.name, i.currentStock, i.unit, i.expiryDate ? formatDate(i.expiryDate) : '', days];
      }),
    );
  };

  return (
    <>
       <PrintHeader title={onlyNear ? 'تقرير الأصناف القريبة من انتهاء الصلاحية' : 'تقرير الصلاحية'} />
      <div className="grid grid-cols-2 gap-4 mb-4 print:grid">
         {!onlyNear && (
           <SummaryCard label="منتهية الصلاحية" value={expired} accent={expired > 0 ? 'danger' : 'success'} />
         )}
        <SummaryCard label="ضمن فترة التنبيه" value={nearExpiry} accent={nearExpiry > 0 ? 'warning' : 'success'} />
      </div>

      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>

      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">اسم المادة</TableHead>
              <TableHead className="text-right">التصنيف</TableHead>
              <TableHead className="text-center">الرصيد</TableHead>
              <TableHead className="text-right">الوحدة</TableHead>
              <TableHead className="text-center">تاريخ الانتهاء</TableHead>
              <TableHead className="text-center">الأيام المتبقية</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
             ) : items.length === 0 ? (
              <EmptyState message={onlyNear ? '✅ لا توجد أصناف قريبة من انتهاء الصلاحية' : '✅ لا توجد أصناف منتهية أو قريبة من انتهاء الصلاحية'} />
            ) : (
              items.map((item: Item) => {
                const days = item.expiryDate
                  ? Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / 86400000)
                  : 0;
                const isExpired = days <= 0;
                return (
                  <TableRow key={item.id} className={isExpired ? 'bg-destructive/5' : 'bg-warning/5'}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.categoryName ?? '—'}</TableCell>
                    <TableCell className="text-center">{item.currentStock.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-sm">{item.unit}</TableCell>
                    <TableCell className="text-center text-sm font-medium">
                      {item.expiryDate ? formatDate(item.expiryDate) : '—'}
                    </TableCell>
                    <TableCell className={`text-center font-bold ${isExpired ? 'text-destructive' : 'text-warning'}`}>
                      {isExpired ? `منتهية منذ ${Math.abs(days)} يوم` : `${days} يوم`}
                    </TableCell>
                    <TableCell className="text-center">
                       {isExpired ? (
                        <Badge variant="destructive" className="text-xs">منتهية الصلاحية</Badge>
                      ) : (
                        <Badge className="bg-warning/15 text-warning border-warning/30 border text-xs">قرب الانتهاء</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── tab 4: below-min ───────────────────────────────────────────────────────

function BelowMinTab() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useGetBelowMinReport();
  const items = data ?? [];

  const critical = items.filter((i) => i.currentStock === 0).length;

  const handleExport = async () => {
    await exportXlsx(
      exportFilename('تقرير-أقل-من-الحد-الأدنى'),
      ['الاسم', 'الرصيد الحالي', 'الحد الأدنى', 'الفرق', 'الوحدة'],
      items.map((i: Item) => [
        i.name,
        i.currentStock,
        i.minStock,
        i.minStock - i.currentStock,
        i.unit,
      ]),
    );
  };

  return (
    <>
      <PrintHeader title="تقرير الأصناف دون الحد الأدنى" />
      <div className="grid grid-cols-2 gap-4 mb-4 print:grid">
        <SummaryCard label="أصناف تحتاج طلبية" value={items.length} accent={items.length > 0 ? 'warning' : 'success'} />
        <SummaryCard label="نفدت من المستودع (صفر)" value={critical} accent={critical > 0 ? 'danger' : 'success'} />
      </div>

      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>

      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">اسم المادة</TableHead>
              <TableHead className="text-right">التصنيف</TableHead>
              <TableHead className="text-center">الرصيد الحالي</TableHead>
              <TableHead className="text-center">الحد الأدنى</TableHead>
              <TableHead className="text-center">الفرق المطلوب</TableHead>
              <TableHead className="text-right">الوحدة</TableHead>
              <TableHead className="text-center print:hidden">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <EmptyState message="✅ جميع الأصناف فوق الحد الأدنى" />
            ) : (
              items.map((item: Item) => {
                const gap = item.minStock - item.currentStock;
                const isCritical = item.currentStock === 0;
                return (
                  <TableRow key={item.id} className={isCritical ? 'bg-destructive/5' : 'bg-warning/5'}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.categoryName ?? '—'}</TableCell>
                    <TableCell className={`text-center font-bold ${isCritical ? 'text-destructive' : 'text-warning'}`}>
                      {item.currentStock.toLocaleString('ar')}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{item.minStock.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={isCritical ? 'destructive' : 'outline'} className="font-mono">
                        +{gap.toLocaleString('ar')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{item.unit}</TableCell>
                    <TableCell className="text-center print:hidden">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setLocation('/transactions/in/new')}
                      >
                        <ExternalLink className="w-3 h-3" />
                        إدخال
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── tab 5: stagnant items ──────────────────────────────────────────────────

function StagnantTab() {
  const { data, isLoading, isError, refetch } = useGetStagnantItemsReport();
  const items = data?.items ?? [];
  const totalStock = items.reduce((sum, item) => sum + item.currentStock, 0);

  const handleExport = async () => {
    await exportXlsx(
      exportFilename('تقرير-المواد-الراكدة'),
      ['الرمز', 'اسم المادة', 'التصنيف', 'الرصيد الحالي', 'الحد الأدنى', 'الوحدة', 'آخر حركة', 'مدة الركود بالأيام', 'الموقع', 'المورد'],
      items.map((item: StagnantItem) => [
        item.code ?? '',
        item.name,
        item.categoryName ?? '',
        item.currentStock,
        item.minStock,
        item.unit,
        item.lastMovementAt ? formatDateTime(item.lastMovementAt) : 'لا توجد حركة مسجلة',
        item.idleDays,
        item.location ?? '',
        item.supplier ?? '',
      ]),
    );
  };

  return (
    <>
      <PrintHeader title="تقرير المواد الراكدة لأكثر من 7 أشهر" />
      <div className="grid grid-cols-2 gap-4 mb-4 print:grid">
        <SummaryCard label="المواد الراكدة" value={items.length} accent={items.length > 0 ? 'warning' : 'success'} />
        <SummaryCard label="الرصيد المجمد" value={totalStock.toLocaleString('ar')} sub="وحدة ضمن مواد راكدة" accent={items.length > 0 ? 'danger' : 'success'} />
      </div>
      <div className="mb-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        يعرض التقرير المواد النشطة ذات الرصيد الموجب التي لم تسجل أي حركة لأكثر من 7 أشهر. تُحتسب كل حركة مسجلة للصنف، بما فيها الإدخال الافتتاحي.
      </div>
      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>
      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">الرمز</TableHead>
              <TableHead className="text-right">اسم المادة</TableHead>
              <TableHead className="text-right">التصنيف</TableHead>
              <TableHead className="text-center">الرصيد</TableHead>
              <TableHead className="text-center">الحد الأدنى</TableHead>
              <TableHead className="text-right">آخر حركة</TableHead>
              <TableHead className="text-center">مدة الركود</TableHead>
              <TableHead className="text-right">الموقع</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <EmptyState message="✅ لا توجد مواد راكدة لأكثر من 7 أشهر" />
            ) : (
              items.map((item: StagnantItem) => (
                <TableRow key={item.id} className="bg-warning/5">
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.code ?? '—'}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/items/${item.id}`} className="text-primary underline-offset-4 hover:underline">
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.categoryName ?? '—'}</TableCell>
                  <TableCell className="text-center font-bold">{item.currentStock.toLocaleString('ar')} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span></TableCell>
                  <TableCell className="text-center text-muted-foreground">{item.minStock.toLocaleString('ar')}</TableCell>
                  <TableCell className="text-sm">{item.lastMovementAt ? formatDateTime(item.lastMovementAt) : 'لا توجد حركة مسجلة'}</TableCell>
                  <TableCell className="text-center">
                    <Badge className="bg-warning/15 text-warning border-warning/30 border text-xs">
                      {item.idleDays.toLocaleString('ar')} يوم
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.location ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── tab 6: equipment ───────────────────────────────────────────────────────

function EquipmentTab() {
  const { data, isLoading, isError, refetch } = useGetEquipmentReport();
  const equipment = data ?? [];

  const countByCondition = equipment.reduce<Record<string, number>>((acc, e) => {
    acc[e.condition] = (acc[e.condition] ?? 0) + 1;
    return acc;
  }, {});

  const handleExport = async () => {
    await exportXlsx(
      exportFilename('تقرير-حالة-التجهيزات'),
      ['الاسم', 'الرقم التسلسلي', 'الموديل', 'الحالة', 'الحائز', 'ملاحظات'],
      equipment.map((e: Equipment) => [
        e.name,
        e.serialNumber ?? '',
        e.model ?? '',
        conditionMap[e.condition]?.label ?? e.condition,
        e.currentHolder ?? '',
        e.notes ?? '',
      ]),
    );
  };

  return (
    <>
      <PrintHeader title="تقرير حالة التجهيزات" />

      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mb-4 print:grid">
        <SummaryCard label="إجمالي التجهيزات" value={equipment.length} />
        <SummaryCard label="جيدة" value={countByCondition['good'] ?? 0} accent="success" />
        <SummaryCard label="صيانة" value={countByCondition['maintenance'] ?? 0} accent="warning" />
        <SummaryCard label="معطلة" value={countByCondition['broken'] ?? 0} accent="danger" />
        <SummaryCard label="تحتاج فحص" value={countByCondition['needs_inspection'] ?? 0} accent="warning" />
      </div>

      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>

      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">اسم التجهيز</TableHead>
              <TableHead className="text-right">الرقم التسلسلي</TableHead>
              <TableHead className="text-right print:hidden">الموديل</TableHead>
              <TableHead className="text-center">الحالة</TableHead>
              <TableHead className="text-right">الحائز الحالي</TableHead>
              <TableHead className="text-right print:hidden">ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
            ) : equipment.length === 0 ? (
              <EmptyState message="لا توجد تجهيزات مسجّلة بعد" />
            ) : (
              equipment.map((eq: Equipment) => {
                const cond = conditionMap[eq.condition] ?? { label: eq.condition, variant: 'default' as const };
                return (
                  <TableRow key={eq.id}>
                    <TableCell className="font-medium"><Link href={`/equipment/${eq.id}`} className="text-primary underline-offset-4 hover:underline">{eq.name}</Link></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{eq.serialNumber ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground print:hidden">{eq.model ?? '—'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={cond.variant} className="text-xs">{cond.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{eq.currentHolder ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground print:hidden max-w-[150px] truncate">
                      {eq.notes ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── tab 6: reconciled stock position ───────────────────────────────────────

function StockPositionTab() {
  const { data, isLoading, isError, refetch } = useGetStockPositionReport();
  const items = data?.items ?? [];
  const equipment = data?.equipment ?? [];
  const totalAvailable =
    items.reduce((sum, item) => sum + item.availableQuantity, 0) +
    equipment.reduce((sum, item) => sum + item.availableQuantity, 0);
  const totalCustody =
    items.reduce((sum, item) => sum + item.custodyQuantity, 0) +
    equipment.reduce((sum, item) => sum + item.custodyQuantity, 0);
  const totalDamaged =
    items.reduce((sum, item) => sum + item.damagedQuantity, 0) +
    equipment.reduce((sum, item) => sum + item.damagedQuantity, 0);

  const handleExport = async () => {
    await exportXlsx(
      exportFilename('تقرير-الوضع-التفصيلي-للمخزون'),
      ['النوع', 'الصنف', 'الإجمالي', 'المتاح', 'العهدة', 'التالف', 'الدفعات'],
      [
        ...items.map((item: StockPositionItem) => [
          'مادة',
          item.name,
          item.currentStock,
          item.availableQuantity,
          item.custodyQuantity,
          item.damagedQuantity,
          item.batches.length,
        ]),
        ...equipment.map((item: StockPositionEquipment) => [
          'تجهيز',
          item.name,
          item.quantity,
          item.availableQuantity,
          item.custodyQuantity,
          item.damagedQuantity,
          null,
        ]),
      ],
    );
  };

  return (
    <>
      <PrintHeader title="تقرير الوضع التفصيلي للمخزون" />
      <div className="grid grid-cols-3 gap-3 mb-4 print:grid">
        <SummaryCard label="المتاح" value={totalAvailable.toLocaleString('ar')} accent="success" />
        <SummaryCard label="على العهدة" value={totalCustody.toLocaleString('ar')} accent="warning" />
        <SummaryCard label="التالف" value={totalDamaged.toLocaleString('ar')} accent="danger" />
      </div>
      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>

      <div className="space-y-6">
        <section className="report-table-shell border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 font-semibold">المواد والدفعات</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">المادة</TableHead>
                <TableHead className="text-center">الرصيد</TableHead>
                <TableHead className="text-center">المتاح</TableHead>
                <TableHead className="text-center">العهدة</TableHead>
                <TableHead className="text-center">التالف</TableHead>
                <TableHead className="text-center">الدفعات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <ReportErrorState onRetry={() => void refetch()} />
              ) : isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
              ) : items.length === 0 ? (
                <EmptyState message="لا توجد مواد مسجّلة بعد" />
              ) : (
                items.map((item: StockPositionItem) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium"><Link href={`/items/${item.id}`} className="text-primary underline-offset-4 hover:underline">{item.name}</Link></TableCell>
                    <TableCell className="text-center">{item.currentStock.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center font-semibold text-success">{item.availableQuantity.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center">{item.custodyQuantity.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center text-destructive">{item.damagedQuantity.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center">{item.batches.length.toLocaleString('ar')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>

        <section className="report-table-shell border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 font-semibold">التجهيزات والحالة</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">التجهيز</TableHead>
                <TableHead className="text-right">الرقم التسلسلي</TableHead>
                <TableHead className="text-center">الإجمالي</TableHead>
                <TableHead className="text-center">المتاح</TableHead>
                <TableHead className="text-center">العهدة</TableHead>
                <TableHead className="text-center">التالف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipment.length === 0 ? (
                <EmptyState message="لا توجد تجهيزات مسجّلة بعد" />
              ) : (
                equipment.map((item: StockPositionEquipment) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium"><Link href={`/equipment/${item.id}`} className="text-primary underline-offset-4 hover:underline">{item.name}</Link></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.serialNumber ?? '—'}</TableCell>
                    <TableCell className="text-center">{item.quantity.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center font-semibold text-success">{item.availableQuantity.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center">{item.custodyQuantity.toLocaleString('ar')}</TableCell>
                    <TableCell className="text-center text-destructive">{item.damagedQuantity.toLocaleString('ar')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </div>
    </>
  );
}

// ─── tab 7: personal custody report ─────────────────────────────────────────

function CustodiesTab() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<'all' | 'open' | 'partially_returned' | 'damaged'>('all');
  const [search, setSearch] = useState('');
  const [overdueDays, setOverdueDays] = useState('30');
  const { data, isLoading, isError, refetch } = useGetCustodiesReport({
    status: status === 'all' ? undefined : status,
    search: search || undefined,
    overdueDays: Number(overdueDays) || 30,
  });
  const records = data?.records ?? [];

  const handleExport = async () => {
    await exportXlsx(
       exportFilename(
         'تقرير-العهد-الشخصية',
         `حالة-${status === 'all' ? 'الكل' : status === 'partially_returned' ? 'إعادة-جزئية' : status === 'damaged' ? 'تالف' : 'مفتوحة'}${search ? '-بحث' : ''}`,
       ),
      ['التجهيز', 'الرقم التسلسلي', 'المستلم', 'مذكرة التسليم', 'التاريخ', 'المكان', 'المتبقي', 'الحالة', 'متأخرة'],
      records.map((record: CustodyReportRecord) => [
        record.equipmentName,
        record.serialNumber ?? '',
        record.holderName,
        record.deliveryNoteNumber,
        formatDate(record.deliveryDate),
        record.location,
         record.outstandingQuantity,
        record.status === 'partially_returned' ? 'إعادة جزئية' : record.status === 'damaged' ? 'تالف' : 'مفتوحة',
        record.overdue ? 'نعم' : 'لا',
      ]),
    );
  };

  return (
    <>
      <PrintHeader title="تقرير العهد الشخصية المفتوحة والمتأخرة" />
      <div className="bg-card border rounded-lg p-4 mb-4 print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input placeholder="بحث بالمستلم أو التجهيز أو المذكرة" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل العهد المفتوحة</SelectItem>
              <SelectItem value="open">مفتوحة</SelectItem>
              <SelectItem value="partially_returned">إعادة جزئية</SelectItem>
              <SelectItem value="damaged">تالف</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Input type="number" min={1} max={3650} value={overdueDays} onChange={(e) => setOverdueDays(e.target.value)} dir="ltr" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">يوم للتأخر</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4 print:grid">
        <SummaryCard label="عهد مفتوحة" value={data?.totals.open ?? 0} />
        <SummaryCard label="الكمية المتبقية" value={(data?.totals.outstandingQuantity ?? 0).toLocaleString('ar')} accent="warning" />
        <SummaryCard label="عهد متأخرة" value={data?.totals.overdue ?? 0} accent={(data?.totals.overdue ?? 0) > 0 ? 'danger' : 'success'} />
      </div>
      <div className="hidden print:block text-xs text-muted-foreground mb-3">
        الفلاتر: الحالة {status === 'all' ? 'كل العهد المفتوحة' : status === 'partially_returned' ? 'إعادة جزئية' : status === 'damaged' ? 'تالف' : 'مفتوحة'}
        · البحث: {search || 'بدون بحث'} · اعتبار العهدة متأخرة بعد {overdueDays} يومًا
      </div>
      <div className="flex justify-end gap-2 mb-4 print:hidden">
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={printCurrentPage}>
          <Printer className="w-4 h-4" />طباعة
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />تصدير Excel
        </Button>
      </div>
      <div className="report-table-shell border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">التجهيز</TableHead>
              <TableHead className="text-right">المستلم</TableHead>
              <TableHead className="text-right">المذكرة</TableHead>
              <TableHead className="text-center">التاريخ</TableHead>
              <TableHead className="text-right">المكان</TableHead>
              <TableHead className="text-center">المتبقي</TableHead>
               <TableHead className="text-center">الحالة</TableHead>
               <TableHead className="text-center print:hidden">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <ReportErrorState onRetry={() => void refetch()} />
            ) : isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">جاري التحميل...</TableCell></TableRow>
            ) : records.length === 0 ? (
              <EmptyState message="لا توجد عهد مفتوحة بهذه المعايير" />
            ) : (
              records.map((record: CustodyReportRecord) => (
                <TableRow key={record.id} className={record.overdue ? 'bg-destructive/5' : ''}>
                  <TableCell className="font-medium">
                    <Link href={`/custodies/${record.id}`} className="text-primary underline-offset-4 hover:underline">{record.equipmentName}</Link>
                    {record.serialNumber && <div className="font-mono text-xs text-muted-foreground">{record.serialNumber}</div>}
                  </TableCell>
                  <TableCell>{record.holderName}</TableCell>
                  <TableCell className="font-mono text-xs">{record.deliveryNoteNumber}</TableCell>
                  <TableCell className="text-center text-sm">{formatDate(record.deliveryDate)}</TableCell>
                  <TableCell className="text-sm">{record.location}</TableCell>
                  <TableCell className="text-center font-semibold">{record.outstandingQuantity.toLocaleString('ar')}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={record.overdue ? 'destructive' : 'secondary'} className="text-xs">
                      {record.overdue ? 'متأخرة' : record.status === 'partially_returned' ? 'إعادة جزئية' : record.status === 'damaged' ? 'تالف' : 'مفتوحة'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center print:hidden">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      onClick={() => setLocation(`/custody/return/new?custodyId=${record.id}`)}
                      disabled={record.outstandingQuantity <= 0}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      إعادة عهدة
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── main page ──────────────────────────────────────────────────────────────

const VALID_TABS = ['stock', 'movements', 'near-expiry', 'expiry', 'below-min', 'stagnant', 'equipment', 'stock-position', 'custodies'] as const;
type TabValue = typeof VALID_TABS[number];

function getInitialTab(): TabValue {
  try {
    const t = new URLSearchParams(window.location.search).get('tab');
    return VALID_TABS.includes(t as TabValue) ? (t as TabValue) : 'stock';
  } catch {
    return 'stock';
  }
}

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>(getInitialTab);

  // Sync tab when URL changes (e.g. browser back/forward)
  useEffect(() => {
    const tab = getInitialTab();
    setActiveTab(tab);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', activeTab);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [activeTab]);

  return (
    <div className="print-report space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">التقارير</h1>
        <p className="text-sm text-muted-foreground">
          اختر التبويب المطلوب لعرض البيانات أو تصديرها
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-9 h-auto print:hidden">
          <TabsTrigger value="stock" className="gap-1.5 text-xs py-2">
            <PackageSearch className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">جرد المخزون</span>
            <span className="sm:hidden">الجرد</span>
          </TabsTrigger>
          <TabsTrigger value="movements" className="gap-1.5 text-xs py-2">
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">حركة المواد</span>
            <span className="sm:hidden">الحركة</span>
          </TabsTrigger>
          <TabsTrigger value="near-expiry" className="gap-1.5 text-xs py-2">
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">قرب الانتهاء</span>
            <span className="sm:hidden">قريبًا</span>
          </TabsTrigger>
          <TabsTrigger value="expiry" className="gap-1.5 text-xs py-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">انتهاء الصلاحية</span>
            <span className="sm:hidden">الصلاحية</span>
          </TabsTrigger>
          <TabsTrigger value="below-min" className="gap-1.5 text-xs py-2">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">أقل من الحد</span>
            <span className="sm:hidden">نواقص</span>
          </TabsTrigger>
          <TabsTrigger value="stagnant" className="gap-1.5 text-xs py-2">
            <Archive className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">مواد راكدة</span>
            <span className="sm:hidden">راكدة</span>
          </TabsTrigger>
          <TabsTrigger value="equipment" className="gap-1.5 text-xs py-2">
            <Stethoscope className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">التجهيزات</span>
            <span className="sm:hidden">تجهيزات</span>
          </TabsTrigger>
          <TabsTrigger value="stock-position" className="gap-1.5 text-xs py-2">
            <Boxes className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">الوضع التفصيلي</span>
            <span className="sm:hidden">الوضع</span>
          </TabsTrigger>
          <TabsTrigger value="custodies" className="gap-1.5 text-xs py-2">
            <UserRoundCheck className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">العهد المفتوحة</span>
            <span className="sm:hidden">العهد</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-0">
          <StockTab />
        </TabsContent>
        <TabsContent value="movements" className="mt-0">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="expiry" className="mt-0">
          <ExpiryTab />
        </TabsContent>
        <TabsContent value="near-expiry" className="mt-0">
          <ExpiryTab onlyNear />
        </TabsContent>
        <TabsContent value="below-min" className="mt-0">
          <BelowMinTab />
        </TabsContent>
        <TabsContent value="stagnant" className="mt-0">
          <StagnantTab />
        </TabsContent>
        <TabsContent value="equipment" className="mt-0">
          <EquipmentTab />
        </TabsContent>
        <TabsContent value="stock-position" className="mt-0">
          <StockPositionTab />
        </TabsContent>
        <TabsContent value="custodies" className="mt-0">
          <CustodiesTab />
        </TabsContent>
      </Tabs>

      {/* Print-only footer */}
      <div className="hidden print:block mt-8 pt-4 border-t text-xs text-muted-foreground text-center">
        مستودعات مديرية صحة دمشق · طُبع بتاريخ {new Date().toLocaleDateString('ar-SY')}
      </div>
    </div>
  );
}
