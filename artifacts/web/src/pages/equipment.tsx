import { useState, useEffect, useRef } from 'react';
import { Link, useRoute, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useListEquipment,
  useDeleteEquipment,
  useGetCurrentUser,
  getEquipmentReport,
  type Equipment,
} from '@workspace/api-client-react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Filter,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  Wrench,
  ShieldAlert,
  CheckCircle2,
  Package,
  Download,
  Upload,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileSpreadsheet,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { EquipmentForm } from './equipment-form';
import { EquipmentDetailsPage } from './equipment-details';
import { AdjustmentForm } from './adjustment-form';
import { downloadFile } from '@/lib/file-download';

/* ─────────────────────────── Condition config ───────────────────────────── */

type ConditionKey = 'good' | 'maintenance' | 'broken' | 'consumed' | 'needs_inspection';

const conditionConfig: Record<ConditionKey, { label: string; className: string }> = {
  good:             { label: 'جيد',          className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800' },
  needs_inspection: { label: 'يحتاج فحص',   className: 'bg-amber-100  text-amber-700  border-amber-200  dark:bg-amber-900/30  dark:text-amber-400  dark:border-amber-800' },
  maintenance:      { label: 'تحت الصيانة', className: 'bg-blue-100   text-blue-700   border-blue-200   dark:bg-blue-900/30   dark:text-blue-400   dark:border-blue-800' },
  broken:           { label: 'معطل',         className: 'bg-red-100    text-red-700    border-red-200    dark:bg-red-900/30    dark:text-red-400    dark:border-red-800' },
  consumed:         { label: 'مستهلك',       className: 'bg-zinc-100   text-zinc-600   border-zinc-200   dark:bg-zinc-800      dark:text-zinc-400   dark:border-zinc-700' },
};

const DEFAULT_TECHNICAL_CONDITIONS = [
  { key: 'good', label: 'جيد' },
  { key: 'needs_inspection', label: 'يحتاج فحص' },
  { key: 'maintenance', label: 'تحت الصيانة' },
  { key: 'broken', label: 'معطل' },
  { key: 'consumed', label: 'مستهلك / متلف' },
];

/* ──────────────────────────── Page router ───────────────────────────────── */

export function EquipmentPage() {
  const [matchNew] = useRoute('/equipment/new');
  const [matchEdit, params] = useRoute('/equipment/:id/edit');
  const [matchAdjust, adjustParams] = useRoute('/equipment/:id/adjust');
  const [matchDetails, detailsParams] = useRoute('/equipment/:id');

  if (matchNew) return <EquipmentForm />;
  if (matchEdit && params?.id) return <EquipmentForm equipmentId={parseInt(params.id)} />;
  if (matchAdjust && adjustParams?.id)
    return <AdjustmentForm preselectedEquipmentId={parseInt(adjustParams.id)} />;
  if (matchDetails && detailsParams?.id) return <EquipmentDetailsPage equipmentId={parseInt(detailsParams.id)} />;

  return <EquipmentList />;
}

/* ──────────────────────────── KPI card ──────────────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  colorClass: string;
  loading: boolean;
}) {
  return (
    <div className="bg-card border rounded-lg p-4 flex items-center gap-4 shadow-sm">
      <div className={`p-2.5 rounded-lg ${colorClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-6 w-10 mb-1" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
      </div>
    </div>
  );
}

/* ─────────────────────── Sortable header ────────────────────────────────── */

type SortKey = 'name' | 'condition' | 'quantity' | 'manufactureYear' | 'createdAt';

function SortableHead({
  label,
  col,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  col: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onSort: (col: SortKey) => void;
  className?: string;
}) {
  const isActive = current === col;
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 transition-colors ${className ?? ''}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          dir === 'asc'
            ? <ArrowUp className="w-3 h-3 text-primary" />
            : <ArrowDown className="w-3 h-3 text-primary" />
        ) : (
          <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />
        )}
      </span>
    </TableHead>
  );
}

/* ─────────────────────── Export button ─────────────────────────────────── */

function ExportButton() {
  const [exporting, setExporting] = useState(false);

  const conditionLabels: Record<string, string> = {
    good: 'جيد', needs_inspection: 'يحتاج فحص',
    maintenance: 'تحت الصيانة', broken: 'معطل', consumed: 'مستهلك',
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await getEquipmentReport();
      if (!data || data.length === 0) { toast.info('لا توجد بيانات للتصدير'); return; }
      const XLSX = await import('xlsx');
      const headers = ['الاسم', 'النوع', 'الموديل', 'الرقم التسلسلي', 'الحالة', 'الكمية', 'الحد الأدنى', 'سنة الصنع', 'بلد المنشأ', 'العهدة الحالية', 'ملاحظات'];
      const rows = (data as Equipment[]).map((eq) => [
        eq.name,
        eq.equipmentType ?? '',
        eq.model ?? '',
        eq.serialNumber ?? '',
        conditionLabels[eq.condition] ?? eq.condition,
        eq.quantity ?? 1,
        eq.minQuantity ?? 0,
        eq.manufactureYear ?? '',
        eq.originCountry ?? '',
        eq.currentHolder ?? '',
        eq.notes ?? '',
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map((_, i) => ({ wch: [20, 15, 15, 18, 14, 8, 10, 10, 14, 18, 25][i] }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'التجهيزات');
      const workbookBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      await downloadFile(
        new Blob([workbookBytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `التجهيزات-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`تم تصدير ${data.length} تجهيز بنجاح`);
    } catch {
      toast.error('حدث خطأ أثناء التصدير');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport} disabled={exporting}>
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          تصدير
        </Button>
      </TooltipTrigger>
      <TooltipContent>تصدير جميع التجهيزات إلى Excel</TooltipContent>
    </Tooltip>
  );
}

/* ─────────────────────── Bulk import dialog ─────────────────────────────── */

function BulkImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ created: number; updated: number; errors: {row:number;name:string;error:string}[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const reset = () => { setStatus('idle'); setResult(null); setErrorMsg(''); if (fileRef.current) fileRef.current.value = ''; };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('parsing');
    setResult(null);
    setErrorMsg('');
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

      const COL_MAP: Record<string, string> = {
        'الاسم': 'name', 'اسم التجهيز': 'name',
        'النوع': 'equipmentType', 'نوع التجهيز': 'equipmentType',
        'الموديل': 'model', 'موديل': 'model',
        'الرقم التسلسلي': 'serialNumber', 'S/N': 'serialNumber', 'سيريال': 'serialNumber',
        'الحالة': 'condition', 'الحالة الفنية': 'condition',
        'سنة الصنع': 'manufactureYear',
        'بلد المنشأ': 'originCountry', 'البلد': 'originCountry',
        'العهدة': 'currentHolder', 'العهدة الحالية': 'currentHolder',
        'ملاحظات': 'notes',
        'الكمية': 'quantity',
        'الحد الأدنى': 'minQuantity', 'حد التنبيه': 'minQuantity',
      };

      const mapped = rows.map((row) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          const mapped_key = COL_MAP[k.trim()] ?? k;
          out[mapped_key] = v;
        }
        return out;
      }).filter(r => r.name);

      if (mapped.length === 0) { setStatus('error'); setErrorMsg('لم يُعثر على بيانات قابلة للقراءة. تأكد من وجود صف رأس وعمود "الاسم".'); return; }

      setStatus('uploading');
      const res = await fetch('/api/equipment/bulk-import?mode=upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapped),
        credentials: 'include',
      });
      if (!res.ok) { const d = await res.json(); setStatus('error'); setErrorMsg(d.error ?? 'حدث خطأ أثناء الاستيراد'); return; }
      const data = await res.json();
      setResult(data);
      setStatus('done');
      onDone();
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message ?? 'خطأ غير متوقع');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 space-y-4" dir="rtl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-emerald-600" />استيراد تجهيزات من Excel</h2>
            <p className="text-sm text-muted-foreground mt-1">يُقبل الملف بصيغة .xlsx أو .xls — الصف الأول رؤوس الأعمدة</p>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-4 h-4" /></button>
        </div>

        {/* Format hint */}
        <div className="rounded-md bg-muted/50 border p-3 text-xs space-y-1">
          <p className="font-semibold mb-1">الأعمدة المدعومة (رؤوس الأعمدة بالعربية أو الإنجليزية):</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>• <b>الاسم</b> (إلزامي)</span>
            <span>• النوع</span>
            <span>• الموديل</span>
            <span>• الرقم التسلسلي</span>
            <span>• الحالة</span>
            <span>• سنة الصنع</span>
            <span>• بلد المنشأ</span>
            <span>• العهدة</span>
            <span>• الكمية</span>
            <span>• الحد الأدنى</span>
          </div>
          <p className="text-muted-foreground mt-1">إذا وُجد رقم تسلسلي متطابق، يُحدَّث السجل (upsert).</p>
        </div>

        {/* Upload area */}
        {status === 'idle' && (
          <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors gap-2">
            <Upload className="w-8 h-8 text-muted-foreground" />
            <span className="text-sm font-medium">اضغط لاختيار ملف Excel</span>
            <span className="text-xs text-muted-foreground">.xlsx أو .xls</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </label>
        )}

        {(status === 'parsing' || status === 'uploading') && (
          <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>{status === 'parsing' ? 'جاري قراءة الملف...' : 'جاري رفع البيانات...'}</span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">{errorMsg}</div>
        )}

        {status === 'done' && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4">
              <FileSpreadsheet className="w-8 h-8 text-emerald-600 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">تم الاستيراد بنجاح</p>
                <p className="text-sm text-emerald-600 dark:text-emerald-500">
                  تمت إضافة {result.created} تجهيز · تحديث {result.updated}
                  {result.errors.length > 0 && ` · ${result.errors.length} خطأ`}
                </p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-md border p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                <p className="font-semibold text-destructive mb-1">أخطاء تفصيلية:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-muted-foreground">صف {e.row}: {e.name} — {e.error}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {status === 'error' && <button onClick={reset} className="text-sm text-primary underline">إعادة المحاولة</button>}
          <Button variant="outline" size="sm" onClick={handleClose}>
            {status === 'done' ? 'إغلاق' : 'إلغاء'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Main list ─────────────────────────────────── */

const PAGE_SIZE = 20;

function EquipmentList() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: currentUser } = useGetCurrentUser();
  const { data: settings } = useQuery<{ technicalConditions?: string | null }>({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings', { credentials: 'include' });
      if (!response.ok) throw new Error('فشل جلب الحالات الفنية');
      return response.json();
    },
  });

  let technicalConditions = DEFAULT_TECHNICAL_CONDITIONS;
  try {
    const parsed = settings?.technicalConditions ? JSON.parse(settings.technicalConditions) : null;
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (item) =>
          item &&
          typeof item.key === 'string' &&
          typeof item.label === 'string',
      )
    ) {
      technicalConditions = parsed;
    }
  } catch { /* use defaults */ }
  const conditionLabels = Object.fromEntries(
    technicalConditions.map((item) => [item.key, item.label]),
  );

  const [search, setSearch]               = useState('');
  const [condition, setCondition]         = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage]                   = useState(1);
  const [deleteTarget, setDeleteTarget]   = useState<Equipment | null>(null);
  const [sortBy, setSortBy]               = useState<SortKey>('createdAt');
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('desc');
  const [importOpen, setImportOpen]       = useState(false);

  /* debounce search */
  useEffect(() => {
    const h = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 450);
    return () => clearTimeout(h);
  }, [search]);

  /* reset page on filter change */
  useEffect(() => { setPage(1); }, [condition]);

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'warehouse_manager';
  // Phase 1 governance: equipment definitions (create/edit/import) are admin-only.
  const canDefine = currentUser?.role === 'admin';

  const handleSort = (col: SortKey) => {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const { data, isLoading } = useListEquipment({
    search: debouncedSearch,
    condition: condition === 'all' ? undefined : condition || undefined,
    page,
    limit: PAGE_SIZE,
    sortBy,
    sortDir,
  } as any);

  /* KPI counters derived from full (unfiltered) totals */
  const { data: allData } = useListEquipment({ limit: 1000 });

  const stats = (() => {
    const list = allData?.equipment ?? [];
    return {
      total:       list.length,
      good:        list.filter(e => e.condition === 'good').length,
      attention:   list.filter(e => e.condition === 'needs_inspection' || e.condition === 'maintenance').length,
      broken:      list.filter(e => e.condition === 'broken' || e.condition === 'consumed').length,
      lowStock:    list.filter(e => (e.minQuantity ?? 0) > 0 && (e.quantity ?? 1) <= (e.minQuantity ?? 0)).length,
    };
  })();

  /* delete mutation */
  const deleteMutation = useDeleteEquipment({
    mutation: {
      onSuccess: () => {
        toast.success('تم حذف التجهيز بنجاح');
        queryClient.invalidateQueries({ queryKey: ['listEquipment'] });
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error('حدث خطأ أثناء حذف التجهيز');
        setDeleteTarget(null);
      },
    },
  });

  const hasFilters = !!(debouncedSearch || (condition && condition !== 'all'));
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const equipment  = data?.equipment ?? [];

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">التجهيزات الطبية</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              إدارة التجهيزات والمعدات الطبية في المستودع
            </p>
          </div>
          {canDefine && (
            <Button onClick={() => setLocation('/equipment/new')} className="gap-2 shrink-0">
              <Plus className="w-4 h-4" />
              إضافة تجهيز
            </Button>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Package}      label="إجمالي التجهيزات" value={stats.total}     colorClass="bg-primary/10 text-primary"            loading={!allData} />
          <StatCard icon={CheckCircle2} label="بحالة جيدة"        value={stats.good}      colorClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" loading={!allData} />
          <StatCard icon={Wrench}       label="تحت الصيانة / فحص" value={stats.attention} colorClass="bg-amber-100   text-amber-600   dark:bg-amber-900/30   dark:text-amber-400"   loading={!allData} />
          <StatCard icon={ShieldAlert}  label="معطلة / نقص"       value={stats.broken + stats.lowStock} colorClass="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" loading={!allData} />
        </div>

        {/* Bulk import dialog */}
        <BulkImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['listEquipment'] })}
        />

        {/* Table card */}
        <div className="bg-card border rounded-lg shadow-sm">

          {/* Toolbar */}
          <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-1 max-w-lg">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم، الموديل، الرقم التسلسلي..."
                  className="pl-3 pr-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {hasFilters && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="مسح الفلاتر"
                      onClick={() => { setSearch(''); setCondition(''); setPage(1); }}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>مسح الفلاتر</TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <div className="w-44">
                <Select value={condition} onValueChange={(v) => { setCondition(v); setPage(1); }}>
                  <SelectTrigger>
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-muted-foreground" />
                      <SelectValue placeholder="تصفية بالحالة" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الحالات</SelectItem>
                    {technicalConditions.map((item) => (
                      <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {data && (
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {data.total} تجهيز
                </span>
              )}
              {/* Export button */}
              <ExportButton />
              {/* Import button — admins/managers only */}
              {canDefine && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setImportOpen(true)}
                    >
                      <Upload className="w-4 h-4" />
                      استيراد
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>استيراد تجهيزات من ملف Excel</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[140px]">الرقم التسلسلي</TableHead>
                  <SortableHead label="اسم التجهيز"   col="name"            current={sortBy} dir={sortDir} onSort={handleSort} />
                  <SortableHead label="الكمية"         col="quantity"        current={sortBy} dir={sortDir} onSort={handleSort} className="text-center w-[90px]" />
                  <TableHead className="w-[160px]">العهدة</TableHead>
                  <SortableHead label="سنة الصنع"     col="manufactureYear" current={sortBy} dir={sortDir} onSort={handleSort} className="w-[100px]" />
                  <SortableHead label="الحالة الفنية" col="condition"       current={sortBy} dir={sortDir} onSort={handleSort} className="w-[140px]" />
                  {canEdit && <TableHead className="w-[90px] text-left">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-40 mb-1.5" />
                        <Skeleton className="h-3 w-28" />
                      </TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      {canEdit && <TableCell />}
                    </TableRow>
                  ))
                ) : equipment.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 7 : 6}
                      className="text-center py-16 text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Activity className="w-10 h-10 opacity-20" />
                        <p className="font-medium">
                          {hasFilters ? 'لا توجد نتائج مطابقة لبحثك' : 'لا توجد تجهيزات مسجّلة بعد'}
                        </p>
                        {hasFilters && (
                          <button
                            className="text-sm text-primary underline underline-offset-2"
                            onClick={() => { setSearch(''); setCondition(''); }}
                          >
                            مسح الفلاتر
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  equipment.map((eq: Equipment) => {
                    const cond = conditionConfig[eq.condition as ConditionKey] ?? {
                      label: conditionLabels[eq.condition] ?? eq.condition,
                      className: '',
                    };
                    const conditionLabel = conditionLabels[eq.condition] ?? cond.label;
                    const qty    = eq.quantity ?? 1;
                    const minQty = eq.minQuantity ?? 0;
                    const isLow  = minQty > 0 && qty <= minQty;

                    return (
                      <TableRow key={eq.id} className="group">
                        {/* S/N */}
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {eq.serialNumber || <span className="opacity-40">—</span>}
                        </TableCell>

                        {/* Name + model */}
                        <TableCell>
                           <Link
                             href={`/equipment/${eq.id}`}
                             className="font-medium leading-snug text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                             aria-label={`فتح بطاقة التجهيز ${eq.name}`}
                           >
                             {eq.name}
                           </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[eq.model, eq.equipmentType].filter(Boolean).join(' • ') || 'بدون موديل'}
                          </p>
                        </TableCell>

                        {/* Quantity */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`text-base font-semibold tabular-nums ${isLow ? 'text-destructive' : ''}`}>
                              {qty}
                            </span>
                            {isLow && (
                              <span className="flex items-center gap-0.5 text-[10px] text-destructive font-medium">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                نقص
                              </span>
                            )}
                            {minQty > 0 && !isLow && (
                              <span className="text-[10px] text-muted-foreground">حد: {minQty}</span>
                            )}
                          </div>
                        </TableCell>

                        {/* Holder */}
                        <TableCell className="text-sm">
                          {eq.currentHolder || <span className="text-muted-foreground opacity-50">—</span>}
                        </TableCell>

                        {/* Year */}
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {eq.manufactureYear || <span className="opacity-40">—</span>}
                        </TableCell>

                        {/* Condition badge */}
                        <TableCell>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cond.className}`}>
                          {conditionLabel}
                          </span>
                          {eq.condition === 'maintenance' && eq.maintenanceSentAt && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              منذ {new Date(eq.maintenanceSentAt).toLocaleDateString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </p>
                          )}
                        </TableCell>

                        {/* Actions */}
                        {canEdit && (
                          <TableCell>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-amber-600 hover:text-amber-600 hover:bg-amber-500/10"
                                    aria-label={`تسوية جرد ${eq.name}`}
                                    onClick={() => setLocation(`/equipment/${eq.id}/adjust`)}
                                  >
                                    <SlidersHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>تسوية جرد</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`تعديل ${eq.name}`}
                                    onClick={() => setLocation(`/equipment/${eq.id}/edit`)}
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>تعديل</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    aria-label={`حذف ${eq.name}`}
                                    onClick={() => setDeleteTarget(eq)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>حذف</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                صفحة {page} من {totalPages}
                {data && ` • إجمالي ${data.total} تجهيز`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="gap-1"
                >
                  <ChevronRight className="h-4 w-4" />
                  السابق
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="gap-1"
                >
                  التالي
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Delete confirmation dialog */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
              <AlertDialogDescription>
                هل تريد حذف التجهيز{' '}
                <span className="font-semibold text-foreground">«{deleteTarget?.name}»</span>؟
                <br />
                هذا الإجراء لا يمكن التراجع عنه.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'جاري الحذف...' : 'حذف التجهيز'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
