import { useState, useEffect, useRef } from 'react';
import { Link, useRoute, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useDeleteItem,
  useGetStockReport,
  useListCategories,
  useGetCurrentUser,
  type Item,
} from '@workspace/api-client-react';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  AlertCircle,
  Clock,
  X,
  SlidersHorizontal,
  Package,
  CheckCircle2,
  AlertTriangle,
  Download,
  Upload,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileSpreadsheet,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Activity,
  Eye,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ItemForm } from './item-form';
import { AdjustmentForm } from './adjustment-form';
import { ItemDetailsPage } from './item-details';
import { downloadFile } from '@/lib/file-download';
import { ConnectionErrorState } from '@/components/app-state';
import { CopyButton } from '@/components/copy-button';

/* ──────────────────────────── Page router ───────────────────────────────── */

export function ItemsPage() {
  const [matchNew] = useRoute('/items/new');
  const [matchEdit, params] = useRoute('/items/:id/edit');
  const [matchAdjust, adjustParams] = useRoute('/items/:id/adjust');
  const [matchDetails, detailsParams] = useRoute('/items/:id');

  if (matchNew) return <ItemForm />;
  if (matchEdit && params?.id) return <ItemForm itemId={parseInt(params.id)} />;
  if (matchAdjust && adjustParams?.id) return <AdjustmentForm preselectedItemId={parseInt(adjustParams.id)} />;
  if (matchDetails && detailsParams?.id) return <ItemDetailsPage itemId={parseInt(detailsParams.id)} />;

  return <ItemsList />;
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

type SortKey = 'name' | 'currentStock' | 'minStock' | 'expiryDate' | 'createdAt';

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

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/reports/stock', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب البيانات');
      const data: Item[] = await res.json();
      if (!data || data.length === 0) { toast.info('لا توجد بيانات للتصدير'); return; }
      const XLSX = await import('xlsx');
      const headers = [
        'الرمز', 'الاسم', 'التصنيف', 'النوع', 'الوحدة',
        'الرصيد الحالي', 'الحد الأدنى', 'تاريخ الصلاحية',
        'رقم التشغيلة', 'الموقع', 'المورد', 'ملاحظات',
      ];
      const rows = data.map((item) => [
        item.code ?? '',
        item.name,
        (item as any).categoryName ?? '',
        item.itemType ?? '',
        item.unit,
        item.currentStock,
        item.minStock,
        item.expiryDate ? String(item.expiryDate).substring(0, 10) : '',
        (item as any).batchNumber ?? '',
        (item as any).location ?? '',
        (item as any).supplier ?? '',
        item.notes ?? '',
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [10, 30, 16, 12, 10, 12, 12, 16, 14, 16, 20, 25].map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'المواد والمستهلكات');
      const workbookBytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      await downloadFile(
        new Blob([workbookBytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `المواد-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success(`تم تصدير ${data.length} صنف بنجاح`);
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
      <TooltipContent>تصدير جميع المواد إلى Excel</TooltipContent>
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
  const [result, setResult] = useState<{ created: number; updated: number; errors: { row: number; name: string; error: string }[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const reset = () => { setStatus('idle'); setResult(null); setErrorMsg(''); if (fileRef.current) fileRef.current.value = ''; };
  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!['.xlsx', '.xls'].includes(extension)) {
      setStatus('error');
      setErrorMsg('صيغة الملف غير مدعومة. اختر ملف Excel بامتداد .xlsx أو .xls.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus('error');
      setErrorMsg('حجم الملف أكبر من الحد المسموح (10 ميغابايت).');
      return;
    }
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
        'الاسم': 'name', 'اسم المادة': 'name', 'name': 'name',
        'الرمز': 'code', 'رمز المادة': 'code', 'code': 'code',
        'التصنيف': 'categoryName', 'تصنيف': 'categoryName', 'category': 'categoryName',
        'الوحدة': 'unit', 'وحدة': 'unit', 'unit': 'unit',
        'الرصيد': 'currentStock', 'الكمية': 'currentStock', 'الرصيد الحالي': 'currentStock', 'currentStock': 'currentStock',
        'الحد الأدنى': 'minStock', 'حد التنبيه': 'minStock', 'minStock': 'minStock',
        'تاريخ الصلاحية': 'expiryDate', 'الصلاحية': 'expiryDate', 'expiryDate': 'expiryDate',
        'رقم التشغيلة': 'batchNumber', 'الدفعة': 'batchNumber', 'batchNumber': 'batchNumber',
        'الموقع': 'location', 'location': 'location',
        'المورد': 'supplier', 'supplier': 'supplier',
        'ملاحظات': 'notes', 'notes': 'notes',
      };

      const mapped = rows.map((row) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          const mappedKey = COL_MAP[k.trim()] ?? k;
          out[mappedKey] = v;
        }
        return out;
      }).filter((r) => r.name);

      if (mapped.length === 0) {
        setStatus('error');
        setErrorMsg('لم يُعثر على بيانات قابلة للقراءة. تأكد من وجود صف رأس وعمود "الاسم".');
        return;
      }

      setStatus('uploading');
      const res = await fetch('/api/items/bulk-import?mode=upsert', {
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

  return (
    <Dialog open={open} onOpenChange={(value) => !value && handleClose()}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              استيراد مواد من Excel
          </DialogTitle>
          <DialogDescription>يُقبل الملف بصيغة .xlsx أو .xls، والصف الأول مخصص لرؤوس الأعمدة. الحد الأقصى 10 ميغابايت.</DialogDescription>
        </DialogHeader>

        {/* Format hint */}
        <div className="rounded-md bg-muted/50 border p-3 text-xs space-y-1">
          <p className="font-semibold mb-1">الأعمدة المدعومة (رؤوس الأعمدة بالعربية أو الإنجليزية):</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>• <b>الاسم</b> (إلزامي)</span>
            <span>• <b>الوحدة</b> (إلزامي)</span>
            <span>• الرمز</span>
            <span>• التصنيف</span>
            <span>• الرصيد الحالي</span>
            <span>• الحد الأدنى</span>
            <span>• تاريخ الصلاحية</span>
            <span>• رقم التشغيلة</span>
            <span>• الموقع</span>
            <span>• المورد</span>
          </div>
          <p className="text-muted-foreground mt-1">إذا وُجد رمز متطابق، يُحدَّث السجل (upsert).</p>
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
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive" role="alert">
            {errorMsg}
          </div>
        )}

        {status === 'done' && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4">
              <FileSpreadsheet className="w-8 h-8 text-emerald-600 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">تم الاستيراد بنجاح</p>
                <p className="text-sm text-emerald-600 dark:text-emerald-500">
                  تمت إضافة {result.created} صنف · تحديث {result.updated}
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

        <DialogFooter className="gap-2">
          {status === 'error' && (
            <Button variant="link" size="sm" onClick={reset}>إعادة المحاولة</Button>
          )}
          <Button variant="outline" size="sm" onClick={handleClose}>
            {status === 'done' ? 'إغلاق' : 'إلغاء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────── Main list ─────────────────────────────────── */

const PAGE_SIZE = 20;

function ItemsList() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: currentUser } = useGetCurrentUser();

  const [search, setSearch]             = useState('');
  const [debouncedSearch, setDeb]       = useState('');
  const [categoryId, setCategoryId]     = useState('');
  const [belowMin, setBelowMin]         = useState(false);
  const [nearExpiry, setNearExpiry]     = useState(false);
  const [page, setPage]                 = useState(1);
  const [sortBy, setSortBy]             = useState<SortKey>('name');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('asc');
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [importOpen, setImportOpen]     = useState(false);

  /* debounce search */
  useEffect(() => {
    const h = setTimeout(() => { setDeb(search); setPage(1); }, 400);
    return () => clearTimeout(h);
  }, [search]);

  /* reset page on filter change */
  useEffect(() => { setPage(1); }, [categoryId, belowMin, nearExpiry]);

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'warehouse_manager';
  const isAdmin = currentUser?.role === 'admin';
  // Phase 1 governance: catalog definitions (create/edit/import) are admin-only.
  const canDefine = isAdmin;

  const handleSort = (col: SortKey) => {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  /* Paginated + filtered list */
  const { data, isLoading, isError, refetch } = useQuery<{ items: Item[]; total: number; page: number; limit: number }>({
    queryKey: ['items', { search: debouncedSearch, categoryId, belowMin, nearExpiry, page, sortBy, sortDir }],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set('search', debouncedSearch);
      if (categoryId)      p.set('categoryId', categoryId);
      if (belowMin)        p.set('belowMin', 'true');
      if (nearExpiry)      p.set('nearExpiry', 'true');
      p.set('page', String(page));
      p.set('limit', String(PAGE_SIZE));
      p.set('sortBy', sortBy);
      p.set('sortDir', sortDir);
      const res = await fetch(`/api/items?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب المواد');
      return res.json();
    },
    staleTime: 30_000,
  });

  /* The stock report is unpaginated and therefore gives KPI cards the complete
     active catalog instead of an arbitrary first page. */
  const { data: stockItems, isLoading: stockItemsLoading } = useGetStockReport();
  const { data: reportSettings } = useQuery<{ expiryAlertDays?: number }>({
    queryKey: ['settings', 'items-expiry'],
    queryFn: async () => {
      const res = await fetch('/api/settings', { credentials: 'include' });
      if (!res.ok) throw new Error('تعذر جلب إعدادات الصلاحية');
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const { data: categoriesData } = useListCategories();
  const deleteMutation = useDeleteItem();

  /* KPI counts from unfiltered data */
  const stats = (() => {
    const list = stockItems ?? [];
    const now = Date.now();
    const expiryWindow = (reportSettings?.expiryAlertDays ?? 30) * 86_400_000;
    return {
      total:      list.length,
      normal:     list.filter((i) => {
        const exp = i.expiryDate ? new Date(i.expiryDate).getTime() : null;
        const expired    = exp !== null && exp < now;
        const nearExp    = exp !== null && !expired && (exp - now) <= expiryWindow;
        const belowMin   = i.minStock > 0 && i.currentStock <= i.minStock;
        return !expired && !nearExp && !belowMin;
      }).length,
      nearExpiry: list.filter((i) => {
        const exp = i.expiryDate ? new Date(i.expiryDate).getTime() : null;
        return exp !== null && exp >= now && (exp - now) <= expiryWindow;
      }).length,
      critical:   list.filter((i) => {
        const exp = i.expiryDate ? new Date(i.expiryDate).getTime() : null;
        return (exp !== null && exp < now) || (i.minStock > 0 && i.currentStock <= i.minStock);
      }).length,
    };
  })();

  const hasFilters = !!(debouncedSearch || categoryId || belowMin || nearExpiry);
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const items = data?.items ?? [];

  const resetFilters = () => {
    setSearch(''); setDeb(''); setCategoryId(''); setBelowMin(false); setNearExpiry(false); setPage(1);
  };

  /* ── Render ────────────────────────────────────────────────────────────── */
  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">المواد والمستهلكات</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              إدارة مواد ومستهلكات المستودع الطبي
            </p>
          </div>
          {canDefine && (
            <Button onClick={() => setLocation('/items/new')} className="gap-2 shrink-0">
              <Plus className="w-4 h-4" />
              إضافة مادة جديدة
            </Button>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            icon={Package}
            label="إجمالي الأصناف"
            value={stats.total}
            colorClass="bg-primary/10 text-primary"
            loading={stockItemsLoading}
          />
          <StatCard
            icon={CheckCircle2}
            label="مخزون طبيعي"
            value={stats.normal}
            colorClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
            loading={stockItemsLoading}
          />
          <StatCard
            icon={Clock}
            label="قرب انتهاء الصلاحية"
            value={stats.nearExpiry}
            colorClass="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
            loading={stockItemsLoading}
          />
          <StatCard
            icon={AlertTriangle}
            label="نقص / منتهية الصلاحية"
            value={stats.critical}
            colorClass="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
            loading={stockItemsLoading}
          />
        </div>

        {/* Bulk import dialog */}
        <BulkImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['items'] });
            queryClient.invalidateQueries({ queryKey: ['items-kpi'] });
          }}
        />

        {/* Table card */}
        <div className="bg-card border rounded-lg shadow-sm">

          {/* Toolbar */}
          <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            {/* Search + clear */}
            <div className="flex gap-2 flex-1 max-w-lg">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم، الرمز، المورد، رقم التشغيلة..."
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
                      onClick={resetFilters}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>مسح الفلاتر</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Filters + counters + actions */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {/* Category filter */}
              <div className="w-44">
                <Select value={categoryId || 'all'} onValueChange={(v) => setCategoryId(v === 'all' ? '' : v)}>
                  <SelectTrigger>
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-muted-foreground" />
                      <SelectValue placeholder="كل التصنيفات" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل التصنيفات</SelectItem>
                    {categoriesData?.map((cat) => (
                      <SelectItem key={cat.id} value={String(cat.id)}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Quick filters */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={belowMin ? 'destructive' : 'outline'}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setBelowMin((v) => !v)}
                  >
                    <AlertCircle className="w-4 h-4" />
                    نقص
                  </Button>
                </TooltipTrigger>
                <TooltipContent>عرض المواد التي وصلت للحد الأدنى</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={nearExpiry ? 'default' : 'outline'}
                    size="sm"
                    className={cn('gap-1.5', nearExpiry && 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600')}
                    onClick={() => setNearExpiry((v) => !v)}
                  >
                    <Clock className="w-4 h-4" />
                    قرب الانتهاء
                  </Button>
                </TooltipTrigger>
                <TooltipContent>عرض المواد قريبة انتهاء الصلاحية</TooltipContent>
              </Tooltip>

              {/* Count */}
              {data && (
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {data.total} صنف
                </span>
              )}

              {/* Export */}
              <ExportButton />

              {/* Import — managers only */}
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
                  <TooltipContent>استيراد مواد من ملف Excel</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {isError && items.length === 0 ? (
            <ConnectionErrorState
              title="تعذر تحميل المواد"
              description="تعذر الوصول إلى قائمة المواد. يمكنك إعادة المحاولة دون فقدان الفلاتر الحالية."
              onRetry={() => void refetch()}
            />
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[130px]">الرمز</TableHead>
                  <SortableHead label="اسم المادة" col="name" current={sortBy} dir={sortDir} onSort={handleSort} />
                  <TableHead>التصنيف</TableHead>
                  <SortableHead label="الرصيد" col="currentStock" current={sortBy} dir={sortDir} onSort={handleSort} className="text-center w-[110px]" />
                  <SortableHead label="الحد الأدنى" col="minStock" current={sortBy} dir={sortDir} onSort={handleSort} className="text-center w-[100px]" />
                  <SortableHead label="الصلاحية" col="expiryDate" current={sortBy} dir={sortDir} onSort={handleSort} className="w-[130px]" />
                  <TableHead className="w-[170px]">الحالة</TableHead>
                  {canEdit && <TableHead className="w-[110px] text-left">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 7 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-40 mb-1.5" />
                        <Skeleton className="h-3 w-24" />
                      </TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      {canEdit && <TableCell />}
                    </TableRow>
                  ))
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canEdit ? 8 : 7}
                      className="text-center py-16 text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Activity className="w-10 h-10 opacity-20" />
                        <p className="font-medium">
                          {hasFilters ? 'لا توجد نتائج مطابقة لبحثك' : 'لا توجد مواد مسجّلة بعد'}
                        </p>
                        {hasFilters && (
                          <button
                            className="text-sm text-primary underline underline-offset-2"
                            onClick={resetFilters}
                          >
                            مسح الفلاتر
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item: Item) => {
                    const now = Date.now();
                    const exp = item.expiryDate ? new Date(item.expiryDate).getTime() : null;
                    const isExpired    = exp !== null && exp < now;
                    const expiryWindow = (reportSettings?.expiryAlertDays ?? 30) * 86_400_000;
                    const isNearExpiry = exp !== null && !isExpired && (exp - now) <= expiryWindow;
                    const isBelowMin   = item.minStock > 0 && item.currentStock <= item.minStock;

                    const rowBg = isExpired || isBelowMin
                      ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100/80 dark:hover:bg-red-950/30'
                      : isNearExpiry
                      ? 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100/80 dark:hover:bg-amber-950/30'
                      : !item.isActive
                      ? 'opacity-50'
                      : '';

                    return (
                      <TableRow key={item.id} className={cn('group', rowBg)}>
                        {/* Code */}
                         <TableCell className="font-mono text-xs text-muted-foreground">
                           {item.code ? (
                             <span className="inline-flex items-center gap-1">
                               <span>{item.code}</span>
                               <CopyButton value={item.code} label="رمز المادة" className="h-7 w-7" />
                             </span>
                           ) : <span className="opacity-40">—</span>}
                        </TableCell>

                        {/* Name */}
                        <TableCell>
                           <Link
                             href={`/items/${item.id}`}
                             className="font-medium leading-snug text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                             aria-label={`فتح بطاقة المادة ${item.name}`}
                           >
                             {item.name}
                           </Link>
                          {(item as any).supplier && (
                            <p className="text-xs text-muted-foreground mt-0.5">{(item as any).supplier}</p>
                          )}
                        </TableCell>

                        {/* Category */}
                        <TableCell className="text-sm text-muted-foreground">
                          {(item as any).categoryName || <span className="opacity-40">—</span>}
                        </TableCell>

                        {/* Current stock */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={cn(
                              'text-base font-semibold tabular-nums',
                              isBelowMin ? 'text-destructive' : ''
                            )}>
                              {item.currentStock.toLocaleString('ar')}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{item.unit}</span>
                            {isBelowMin && (
                              <span className="flex items-center gap-0.5 text-[10px] text-destructive font-medium">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                نقص
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Min stock */}
                        <TableCell className="text-center text-sm text-muted-foreground tabular-nums">
                          {item.minStock > 0 ? item.minStock : <span className="opacity-40">—</span>}
                        </TableCell>

                        {/* Expiry */}
                        <TableCell>
                          <span className={cn(
                            'text-sm tabular-nums',
                            isExpired    ? 'text-destructive font-bold' :
                            isNearExpiry ? 'text-amber-600 dark:text-amber-400 font-bold' :
                            'text-muted-foreground'
                          )}>
                            {item.expiryDate ? String(item.expiryDate).substring(0, 10) : <span className="opacity-40">—</span>}
                          </span>
                        </TableCell>

                        {/* Status badges */}
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {isExpired && (
                              <Badge variant="destructive" className="text-[10px]">منتهية الصلاحية</Badge>
                            )}
                            {isBelowMin && !isExpired && (
                              <Badge variant="destructive" className="text-[10px] gap-1">
                                <AlertCircle className="w-3 h-3" />نقص
                              </Badge>
                            )}
                            {isNearExpiry && (
                              <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 border text-[10px] gap-1">
                                <Clock className="w-3 h-3" />قريب الانتهاء
                              </Badge>
                            )}
                            {!isBelowMin && !isNearExpiry && !isExpired && item.isActive && (
                              <Badge variant="secondary" className="text-[10px]">طبيعي</Badge>
                            )}
                            {!item.isActive && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">معطّل</Badge>
                            )}
                          </div>
                        </TableCell>

                         {/* Actions remain visible on touch devices; hover only reduces desktop density. */}
                        {canEdit && (
                          <TableCell>
                             <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                   <Button
                                     variant="ghost"
                                     size="icon"
                                     className="h-8 w-8 text-primary"
                                     aria-label={`عرض تفاصيل ${item.name}`}
                                     onClick={() => setLocation(`/items/${item.id}`)}
                                   >
                                     <Eye className="h-3.5 w-3.5" />
                                   </Button>
                                 </TooltipTrigger>
                                 <TooltipContent>تفاصيل المادة</TooltipContent>
                               </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`تعديل ${item.name}`}
                                    onClick={() => setLocation(`/items/${item.id}/edit`)}
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
                                    className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                    aria-label={`تسوية جرد ${item.name}`}
                                    onClick={() => setLocation(`/items/${item.id}/adjust`)}
                                  >
                                    <SlidersHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>تسوية جرد</TooltipContent>
                              </Tooltip>

                              {isAdmin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      aria-label={`حذف ${item.name}`}
                                      onClick={() => setDeleteTarget(item)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>حذف</TooltipContent>
                                </Tooltip>
                              )}
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
          )}

          {/* Pagination */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                صفحة {page} من {totalPages}
                {data && ` • إجمالي ${data.total} صنف`}
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
                هل تريد حذف المادة{' '}
                <span className="font-semibold text-foreground">«{deleteTarget?.name}»</span>؟
                <br />
                سيتم إيقاف تفعيل هذه المادة ولن تظهر في القوائم.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (!deleteTarget) return;
                  deleteMutation.mutate(
                    { id: deleteTarget.id },
                    {
                      onSuccess: () => {
                        toast.success('تم حذف المادة بنجاح');
                        queryClient.invalidateQueries({ queryKey: ['items'] });
                        queryClient.invalidateQueries({ queryKey: ['items-kpi'] });
                        setDeleteTarget(null);
                      },
                      onError: () => {
                        toast.error('حدث خطأ أثناء حذف المادة');
                        setDeleteTarget(null);
                      },
                    }
                  );
                }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'جاري الحذف...' : 'حذف المادة'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </TooltipProvider>
  );
}
