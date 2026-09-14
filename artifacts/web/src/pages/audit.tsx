import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import {
  ShieldCheck,
  Download,
  RotateCcw,
  LogIn,
  LogOut,
  Plus,
  Edit,
  Trash2,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleCheck,
  CircleX,
  Archive,
  Settings2,
  Eye,
  UserRound,
  Clock3,
  Globe2,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { downloadFile } from '@/lib/file-download';
import { isValidIsoDate } from '@/lib/inventory-validation';
import { CopyButton } from '@/components/copy-button';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  userId: number | null;
  userNameSnap: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditResponse {
  data: AuditEntry[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Label maps ─────────────────────────────────────────────────────────────

const actionLabels: Record<string, { label: string; color: string }> = {
  login:           { label: 'دخول للنظام',    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  logout:          { label: 'خروج من النظام', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  create:          { label: 'إضافة',          color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  update:          { label: 'تعديل',          color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  delete:          { label: 'حذف',            color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  deactivate:      { label: 'تعطيل',          color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  activate:        { label: 'تفعيل',          color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  transaction_in:  { label: 'إدخال مواد',     color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  transaction_out: { label: 'إخراج مواد',     color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  movement_created: { label: 'تسجيل حركة',    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  movement_failed:  { label: 'فشل حركة',      color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  backup_export:    { label: 'تصدير نسخة',    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  backup_restore:   { label: 'استعادة نسخة',  color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  backup_catalog_create: { label: 'إنشاء سجل نسخة', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  backup_package_export: { label: 'تصدير حزمة نسخة', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  backup_package_restore: { label: 'استعادة حزمة نسخة', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  backup_restore_rollback: { label: 'التراجع عن الاستعادة', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  license_activated: { label: 'تفعيل الترخيص', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sync_session_create: { label: 'إنشاء جلسة مزامنة', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_session_handshake: { label: 'مصافحة جلسة مزامنة', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_package_apply: { label: 'تطبيق حزمة مزامنة', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_package_ack: { label: 'تأكيد حزمة مزامنة', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sync_pairing_consume: { label: 'استخدام رمز اقتران', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_trusted_node_revoke: { label: 'إلغاء عقدة موثوقة', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  sync_conflict_resolve: { label: 'حل تعارض مزامنة', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sync_relay_upload: { label: 'رفع حزمة للمزامنة', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_exchange: { label: 'تبادل بيانات', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_exchange_rejected_signature: { label: 'رفض توقيع المزامنة', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  sync_package_export: { label: 'تصدير حزمة مزامنة', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  sync_package_import: { label: 'استيراد حزمة مزامنة', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  sync_package_import_merge: { label: 'دمج حزمة مزامنة', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
};

const entityLabels: Record<string, string> = {
  item:        'مادة',
  equipment:   'تجهيز',
  transaction: 'عملية',
  user:        'مستخدم',
  settings:    'الإعدادات',
  category:    'تصنيف',
  recipient:   'جهة مستلمة',
  exit_reason: 'سبب إخراج',
  backup:      'نسخة احتياطية',
  sync_session: 'جلسة مزامنة',
  sync_package: 'حزمة مزامنة',
  sync_trusted_node: 'عقدة موثوقة',
  sync_relay_package: 'حزمة ترحيل',
  sync_conflict: 'تعارض مزامنة',
  inventory_batch: 'دفعة مخزنية',
  batch_allocation: 'تخصيص دفعة',
  personal_custody: 'عهدة شخصية',
  custody_return: 'إعادة عهدة',
  damage_record: 'سجل تلف',
  central_return: 'إعادة مركزية',
  license: 'ترخيص',
};

const actionIcons: Record<string, React.ReactNode> = {
  login:           <LogIn className="w-3.5 h-3.5" />,
  logout:          <LogOut className="w-3.5 h-3.5" />,
  create:          <Plus className="w-3.5 h-3.5" />,
  update:          <Edit className="w-3.5 h-3.5" />,
  delete:          <Trash2 className="w-3.5 h-3.5" />,
  transaction_in:  <ArrowDownToLine className="w-3.5 h-3.5" />,
  transaction_out: <ArrowUpFromLine className="w-3.5 h-3.5" />,
  movement_created: <CircleCheck className="w-3.5 h-3.5" />,
  movement_failed: <CircleX className="w-3.5 h-3.5" />,
  backup_export: <Archive className="w-3.5 h-3.5" />,
  backup_restore: <Archive className="w-3.5 h-3.5" />,
  deactivate: <Settings2 className="w-3.5 h-3.5" />,
  activate: <CheckCircle2 className="w-3.5 h-3.5" />,
};

const DEFAULT_ACTION_META = {
  label: 'نشاط نظامي',
  color: 'bg-muted text-muted-foreground',
};

const DETAIL_LABELS: Record<string, string> = {
  username: 'اسم المستخدم',
  fullName: 'الاسم الكامل',
  name: 'الاسم',
  itemName: 'اسم المادة',
  equipmentName: 'اسم التجهيز',
  role: 'الصلاحية',
  isActive: 'الحالة',
  action: 'الإجراء الداخلي',
  nodeId: 'معرّف العقدة',
  bytes: 'الحجم',
  message: 'الرسالة',
  reason: 'رقم المحضر',
  quantity: 'الكمية',
  unit: 'الوحدة',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'مدير النظام',
  manager: 'مدير',
  user: 'مستخدم',
};

const INTERNAL_ACTION_LABELS: Record<string, string> = {
  password_changed: 'تغيير كلمة المرور',
};

function formatAuditValue(value: unknown, key?: string): string {
  if (key === 'role' && typeof value === 'string') return ROLE_LABELS[value] ?? value;
  if (key === 'action' && typeof value === 'string') return INTERNAL_ACTION_LABELS[value] ?? value;
  if (key === 'isActive' && typeof value === 'boolean') return value ? 'مفعّل' : 'غير مفعّل';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return value.toLocaleString('ar-SY');
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '—';
}

function getEntrySummary(entry: AuditEntry): string {
  const details = entry.details ?? {};
  const preferredKeys = ['name', 'itemName', 'equipmentName', 'fullName', 'username', 'message'];
  const detail = preferredKeys
    .map((key) => [key, details[key]] as const)
    .find(([, value]) => value != null && value !== '');

  if (detail) {
    return `${DETAIL_LABELS[detail[0]] ?? 'التفاصيل'}: ${formatAuditValue(detail[1], detail[0])}`;
  }
  return entry.entityId ? `السجل رقم ${entry.entityId.toLocaleString('ar-SY')}` : 'بدون تفاصيل إضافية';
}

function formatExactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'وقت غير معروف';
  return new Intl.DateTimeFormat('ar-SY', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date);
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function AuditPage() {
  const [, setLocation] = useLocation();
  const { data: user } = useGetCurrentUser();

  // Redirect non-admins
  useEffect(() => {
    if (user && user.role !== 'admin') setLocation('/');
  }, [user, setLocation]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('all');
  const [entityType, setEntityType] = useState('all');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const dateError = from && !isValidIsoDate(from)
    ? 'تاريخ البداية غير صالح'
    : to && !isValidIsoDate(to)
      ? 'تاريخ النهاية غير صالح'
      : from && to && from > to
        ? 'يجب أن يسبق تاريخ البداية تاريخ النهاية'
        : '';

  const { data, isLoading, isError, refetch } = useQuery<AuditResponse>({
    queryKey: ['audit', { from, to, action, entityType, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (action !== 'all') params.set('action', action);
      if (entityType !== 'all') params.set('entityType', entityType);
      params.set('page', String(page));
      params.set('limit', '50');
      const res = await fetch(`/api/audit?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب سجل التدقيق');
      return res.json();
    },
    staleTime: 30_000,
    enabled: !dateError,
  });

  const hasFilters = from || to || action !== 'all' || entityType !== 'all';

  const resetFilters = () => {
    setFrom(''); setTo(''); setAction('all'); setEntityType('all'); setPage(1);
  };

  const handleExport = async () => {
    if (!data?.total || exporting) return;
    setExporting(true);
    try {
      const allEntries: AuditEntry[] = [];
      const totalPages = Math.max(1, data.totalPages);

      for (let exportPage = 1; exportPage <= totalPages; exportPage += 1) {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (action !== 'all') params.set('action', action);
        if (entityType !== 'all') params.set('entityType', entityType);
        params.set('page', String(exportPage));
        params.set('limit', '100');
        const response = await fetch(`/api/audit?${params}`, { credentials: 'include' });
        if (!response.ok) throw new Error('فشل جلب سجل التدقيق للتصدير');
        const result = (await response.json()) as AuditResponse;
        allEntries.push(...result.data);
      }

      if (allEntries.length === 0) {
        toast({ description: 'لا توجد بيانات لتصديرها' });
        return;
      }

      const headers = ['التاريخ والوقت', 'المستخدم', 'الإجراء', 'نوع البيانات', 'رقم السجل', 'عنوان IP'];
      const rows = allEntries.map((e) => [
        formatDateTime(e.createdAt),
        e.userNameSnap ?? '—',
        actionLabels[e.action]?.label ?? 'نشاط نظامي',
        entityLabels[e.entityType] ?? 'سجل النظام',
        String(e.entityId ?? '—'),
        e.ipAddress ?? '—',
      ]);
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      worksheet['!cols'] = headers.map((header, index) => {
        const longestValue = rows.reduce(
          (max, row) => Math.max(max, String(row[index] ?? '').length),
          header.length,
        );
        return { wch: Math.min(42, Math.max(14, longestValue + 2)) };
      });
      worksheet['!autofilter'] = { ref: `A1:F${rows.length + 1}` };
      worksheet['!views'] = [{ RTL: true }];
      const workbook = XLSX.utils.book_new();
      workbook.Props = {
        Title: 'سجل التدقيق',
        Subject: 'سجل التدقيق — مستودعات مديرية صحة دمشق',
        Author: 'مستودعات مديرية صحة دمشق',
        CreatedDate: new Date(),
      };
      XLSX.utils.book_append_sheet(workbook, worksheet, 'سجل التدقيق');
      const workbookBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([workbookBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      await downloadFile(blob, `سجل-التدقيق-${new Date().toISOString().split('T')[0]}.xlsx`);
      toast({ description: `تم تصدير ${allEntries.length.toLocaleString('ar')} سجل بنجاح` });
    } catch (error) {
      console.error('Audit export failed:', error);
      toast({ variant: 'destructive', description: 'تعذر إنشاء ملف Excel. حاول مرة أخرى' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">سجل التدقيق</h1>
            <p className="text-sm text-muted-foreground">
              جميع العمليات المنفذة على النظام — للقراءة فقط
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={!data?.total || exporting}>
          <Download className="w-4 h-4" />
          {exporting ? 'جاري التصدير...' : 'تصدير Excel'}
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-card border rounded-lg p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">من تاريخ</label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">إلى تاريخ</label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">نوع الإجراء</label>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الإجراءات</SelectItem>
                {Object.entries(actionLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">نوع البيانات</label>
            <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأنواع</SelectItem>
                {Object.entries(entityLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {hasFilters && (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={resetFilters}>
              <RotateCcw className="w-3.5 h-3.5" />
              إعادة ضبط الفلاتر
            </Button>
          </div>
        )}
      </div>
      {dateError && (
        <Alert variant="destructive">
          <AlertDescription>{dateError}</AlertDescription>
        </Alert>
      )}

      {/* Stats bar */}
      {data && (
        <div className="text-sm text-muted-foreground">
          إجمالي السجلات: <span className="font-semibold text-foreground">{data.total.toLocaleString('ar')}</span>
          {data.totalPages > 1 && (
            <span className="mr-3">الصفحة {data.page} من {data.totalPages}</span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">التاريخ والوقت</TableHead>
              <TableHead className="text-right">المستخدم</TableHead>
              <TableHead className="text-right">الإجراء</TableHead>
              <TableHead className="text-right">البيانات المتأثرة</TableHead>
              <TableHead className="text-right">التفاصيل</TableHead>
              <TableHead className="text-right">عنوان IP</TableHead>
              <TableHead className="text-right w-16">عرض</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={7} className="p-4">
                  <Alert variant="destructive">
                    <AlertDescription>
                      تعذر تحميل سجل التدقيق. تحقق من اتصال الخادم ثم أعد المحاولة.
                      <div><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>إعادة المحاولة</Button></div>
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  جاري تحميل السجل...
                </TableCell>
              </TableRow>
            ) : !data?.data.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  {hasFilters ? 'لا توجد سجلات بهذه الفلاتر' : 'لا توجد سجلات بعد'}
                </TableCell>
              </TableRow>
            ) : (
              data.data.map((entry) => {
                const actionMeta = actionLabels[entry.action] ?? DEFAULT_ACTION_META;
                return (
                  <TableRow key={entry.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {entry.userNameSnap ?? (
                        <span className="text-muted-foreground italic">نظام</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${actionMeta.color}`}>
                        {actionIcons[entry.action] ?? <Settings2 className="w-3.5 h-3.5" />}
                        {actionMeta.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="text-muted-foreground">
                        {entityLabels[entry.entityType] ?? 'سجل النظام'}
                      </span>
                      {entry.entityId && (
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          #{entry.entityId}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-muted-foreground">
                          {getEntrySummary(entry)}
                        </span>
                        {entry.details && Object.keys(entry.details).length > 1 && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {Object.keys(entry.details).length} حقول
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.ipAddress ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="عرض تفاصيل السجل"
                        aria-label={`عرض تفاصيل السجل رقم ${entry.id}`}
                        onClick={() => setSelectedEntry(entry)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            السابق
          </Button>
          <span className="flex items-center px-3 text-sm text-muted-foreground">
            {page} / {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </Button>
        </div>
      )}

      <Dialog
        open={Boolean(selectedEntry)}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          {selectedEntry && (() => {
            const selectedAction = actionLabels[selectedEntry.action] ?? DEFAULT_ACTION_META;
            const selectedDetails = Object.entries(selectedEntry.details ?? {})
              .filter(([, value]) => value != null && value !== '');

            return (
              <>
                <DialogHeader className="text-right">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge className={`gap-1.5 ${selectedAction.color}`}>
                      {actionIcons[selectedEntry.action] ?? <Settings2 className="h-3.5 w-3.5" />}
                      {selectedAction.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      سجل رقم {selectedEntry.id.toLocaleString('ar-SY')}
                    </span>
                  </div>
                   <div className="flex items-center justify-between gap-2">
                     <DialogTitle>تفاصيل سجل التدقيق</DialogTitle>
                     <CopyButton value={JSON.stringify(selectedEntry.details ?? {}, null, 2)} label="تفاصيل السجل" />
                   </div>
                  <DialogDescription>
                    تفاصيل كاملة للعملية المسجلة — للقراءة فقط.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" />
                      العملية والبيانات
                    </div>
                    <p className="text-sm font-semibold">
                      {selectedAction.label} — {entityLabels[selectedEntry.entityType] ?? 'سجل النظام'}
                      {selectedEntry.entityId && ` #${selectedEntry.entityId}`}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <UserRound className="h-3.5 w-3.5" />
                      المستخدم المنفذ
                    </div>
                    <p className="text-sm font-semibold">
                      {selectedEntry.userNameSnap ?? 'النظام'}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      التاريخ والوقت
                    </div>
                    <p className="text-sm font-semibold">{formatExactDateTime(selectedEntry.createdAt)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Globe2 className="h-3.5 w-3.5" />
                      عنوان IP
                    </div>
                    <p className="font-mono text-sm" dir="ltr">{selectedEntry.ipAddress ?? 'غير متوفر'}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      نوع السجل
                    </div>
                    <p className="text-sm font-semibold">
                      {entityLabels[selectedEntry.entityType] ?? 'سجل النظام'}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">البيانات المسجلة</h3>
                  </div>
                  {selectedDetails.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      لا توجد تفاصيل إضافية لهذه العملية.
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selectedDetails.map(([key, value]) => (
                        <div key={key} className="rounded-lg border p-3">
                          <p className="mb-1 text-xs text-muted-foreground">
                            {DETAIL_LABELS[key] ?? 'تفصيل إضافي'}
                          </p>
                          <p className="break-words text-sm font-medium">
                            {formatAuditValue(value, key)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setSelectedEntry(null)}>
                    إغلاق
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
