import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useGetCurrentUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import {
  Settings2,
  KeyRound,
  Building2,
  Save,
  User as UserIcon,
  DatabaseBackup,
  Download,
  Ruler,
  Plus,
  X,
  CheckCircle2,
  Tag,
  Pencil,
  Trash2,
  FileSpreadsheet,
  Upload,
  Loader2,
  Activity,
  LogIn,
  LogOut as LogOutIcon,
  ArrowDownToLine,
  ArrowUpFromLine,
  ShieldCheck,
  Eye,
  EyeOff,
  UsersRound,
  ListChecks,
  Power,
  Wrench,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/file-download';
interface SystemSettings {
  id: number;
  orgName: string;
  orgSubtitle?: string | null;
  expiryAlertDays: number;
  unitsList?: string | null;
  technicalConditions?: string | null;
  returnConditions?: string | null;
  setupCompleted: boolean;
  updatedAt: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchSettings(): Promise<SystemSettings> {
  const res = await fetch('/api/settings', { credentials: 'include' });
  if (!res.ok) throw new Error('فشل جلب الإعدادات');
  return res.json() as Promise<SystemSettings>;
}

async function saveSettings(
  data: Partial<Pick<SystemSettings, 'orgName' | 'orgSubtitle' | 'expiryAlertDays' | 'unitsList' | 'technicalConditions' | 'returnConditions'>>,
): Promise<SystemSettings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'فشل حفظ الإعدادات');
  }
  return res.json() as Promise<SystemSettings>;
}

async function changePassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const res = await fetch('/api/settings/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'فشل تغيير كلمة المرور');
  }
}

const DEFAULT_UNITS = [
  'قطعة', 'علبة', 'لتر', 'مل', 'كيس', 'زجاجة', 'برميل',
  'رول', 'كرتون', 'طرد', 'حبة', 'زوج', 'مجموعة', 'جرام', 'كيلوغرام',
];

const DEFAULT_TECHNICAL_CONDITIONS = [
  { key: 'good', label: 'جيد' },
  { key: 'needs_inspection', label: 'يحتاج فحص' },
  { key: 'maintenance', label: 'تحت الصيانة' },
  { key: 'broken', label: 'معطل' },
  { key: 'consumed', label: 'مستهلك / متلف' },
];

const DEFAULT_RETURN_CONDITIONS = [
  { key: 'good', label: 'جيد', behavior: 'good' },
  { key: 'damaged', label: 'تالف', behavior: 'damaged' },
  { key: 'needs_maintenance', label: 'يحتاج صيانة', behavior: 'needs_maintenance' },
  { key: 'missing', label: 'مفقود', behavior: 'missing' },
];

// ─── Settings Page ────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `منذ ${d} يوم`;
  return new Date(iso).toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' });
}

export function ActivityTab() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const { data: entries = [], isLoading, isError, refetch } = useQuery<AuditEntry[]>({
    queryKey: ['my-activity'],
    queryFn: async () => {
      const res = await fetch('/api/settings/my-activity', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب السجل');
      return res.json();
    },
    refetchInterval: 30_000,
  });
  const visibleEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (actionFilter !== 'all' && entry.action !== actionFilter) return false;
      if (!query) return true;
      const detail = formatActivityDetail(entry).toLocaleLowerCase();
      return `${entry.action} ${entry.entityType} ${detail}`.includes(query);
    });
  }, [actionFilter, entries, search]);

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">عرض {visibleEntries.length} من آخر {entries.length} نشاطًا</span>
        </div>
         <span className="text-xs text-muted-foreground">يتجدد تلقائياً</span>
      </div>

       <div className="grid gap-2 border-b bg-muted/10 p-4 sm:grid-cols-[1fr_12rem]">
         <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث في النشاط..." />
         <Select value={actionFilter} onValueChange={setActionFilter}>
           <SelectTrigger><SelectValue placeholder="نوع النشاط" /></SelectTrigger>
           <SelectContent>
             <SelectItem value="all">كل الأنشطة</SelectItem>
             {Object.entries(ACT_META).map(([key, meta]) => <SelectItem key={key} value={key}>{meta.label}</SelectItem>)}
           </SelectContent>
         </Select>
       </div>

       {isError ? (
         <div className="py-12 text-center">
           <p className="text-sm text-destructive">تعذر تحميل سجل النشاط.</p>
           <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => void refetch()}>
             <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
           </Button>
         </div>
       ) : isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 opacity-40" />
          جاري التحميل...
        </div>
       ) : visibleEntries.length === 0 ? (
        <div className="py-12 text-center">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
           <p className="text-sm text-muted-foreground">{entries.length ? 'لا توجد نتائج بهذه الفلاتر' : 'لا توجد نشاطات مسجّلة بعد'}</p>
        </div>
      ) : (
        <div className="divide-y">
           {visibleEntries.map(entry => {
             const meta = ACT_META[entry.action] ?? DEFAULT_ACTIVITY_META;
             const entityAr = ENTITY_AR[entry.entityType] ?? 'سجل النظام';
             const detailText = formatActivityDetail(entry);
            return (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                {/* Action badge */}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium shrink-0 ${meta?.color ?? 'bg-muted text-muted-foreground'}`}>
                  {meta?.icon}
                  {meta?.label ?? entry.action}
                </span>
                {/* Entity */}
                <span className="text-sm text-muted-foreground shrink-0">{entityAr}</span>
                {/* Detail */}
                {detailText && (
                  <span className="text-sm font-medium truncate flex-1">{detailText}</span>
                )}
                <div className="flex-1" />
                {/* Time */}
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {timeAgo(entry.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Org Tab ──────────────────────────────────────────────────────────────────


interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const ACT_META: Record<string, { label: string; icon: ReactNode; color: string }> = {
  login:           { label: 'دخول للنظام',     icon: <LogIn className="w-3.5 h-3.5" />,              color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  logout:          { label: 'خروج من النظام',   icon: <LogOutIcon className="w-3.5 h-3.5" />,         color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  create:          { label: 'إضافة',            icon: <Plus className="w-3.5 h-3.5" />,               color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  update:          { label: 'تعديل',            icon: <Pencil className="w-3.5 h-3.5" />,             color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  delete:          { label: 'حذف',              icon: <Trash2 className="w-3.5 h-3.5" />,             color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  deactivate:      { label: 'تعطيل',            icon: <Power className="w-3.5 h-3.5" />,              color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  activate:        { label: 'تفعيل',            icon: <CheckCircle2 className="w-3.5 h-3.5" />,       color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  transaction_in:  { label: 'إدخال مواد',       icon: <ArrowDownToLine className="w-3.5 h-3.5" />,    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  transaction_out: { label: 'إخراج مواد',       icon: <ArrowUpFromLine className="w-3.5 h-3.5" />,    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  movement_created: { label: 'تسجيل حركة',      icon: <CheckCircle2 className="w-3.5 h-3.5" />,       color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  movement_failed:  { label: 'فشل حركة',        icon: <X className="w-3.5 h-3.5" />,                  color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  backup_export:   { label: 'تصدير نسخة',       icon: <Download className="w-3.5 h-3.5" />,           color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  backup_restore:  { label: 'استعادة نسخة',     icon: <DatabaseBackup className="w-3.5 h-3.5" />,     color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  backup_catalog_create: { label: 'إنشاء سجل نسخة', icon: <DatabaseBackup className="w-3.5 h-3.5" />, color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  backup_package_export: { label: 'تصدير حزمة نسخة', icon: <Download className="w-3.5 h-3.5" />, color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  backup_package_restore: { label: 'استعادة حزمة نسخة', icon: <DatabaseBackup className="w-3.5 h-3.5" />, color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  backup_restore_rollback: { label: 'التراجع عن الاستعادة', icon: <ArrowUpFromLine className="w-3.5 h-3.5" />, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  license_activated: { label: 'تفعيل الترخيص', icon: <ShieldCheck className="w-3.5 h-3.5" />, color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sync_session_create: { label: 'إنشاء جلسة مزامنة', icon: <Activity className="w-3.5 h-3.5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_session_handshake: { label: 'مصافحة جلسة مزامنة', icon: <Activity className="w-3.5 h-3.5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_package_apply: { label: 'تطبيق حزمة مزامنة', icon: <Activity className="w-3.5 h-3.5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_package_ack: { label: 'تأكيد حزمة مزامنة', icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sync_pairing_consume: { label: 'استخدام رمز اقتران', icon: <Activity className="w-3.5 h-3.5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_trusted_node_revoke: { label: 'إلغاء عقدة موثوقة', icon: <Trash2 className="w-3.5 h-3.5" />, color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  sync_conflict_resolve: { label: 'حل تعارض مزامنة', icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  sync_relay_upload: { label: 'رفع حزمة للمزامنة', icon: <Download className="w-3.5 h-3.5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_exchange: { label: 'تبادل بيانات', icon: <Activity className="w-3.5 h-3.5" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  sync_exchange_rejected_signature: { label: 'رفض توقيع المزامنة', icon: <X className="w-3.5 h-3.5" />, color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  sync_package_export: { label: 'تصدير حزمة مزامنة', icon: <Download className="w-3.5 h-3.5" />, color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  sync_package_import: { label: 'استيراد حزمة مزامنة', icon: <Upload className="w-3.5 h-3.5" />, color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  sync_package_import_merge: { label: 'دمج حزمة مزامنة', icon: <Activity className="w-3.5 h-3.5" />, color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
};

const ENTITY_AR: Record<string, string> = {
  item:               'مادة',
  equipment:          'تجهيز',
  transaction:        'عملية',
  user:               'مستخدم',
  category:           'تصنيف',
  recipient:           'جهة مستلمة',
  exit_reason:         'سبب إخراج',
  backup:              'نسخة احتياطية',
  sync_session:        'جلسة مزامنة',
  sync_package:        'حزمة مزامنة',
  sync_trusted_node:  'عقدة موثوقة',
  sync_relay_package: 'حزمة ترحيل',
  sync_conflict:       'تعارض مزامنة',
  inventory_batch:     'دفعة مخزنية',
  batch_allocation:    'تخصيص دفعة',
  personal_custody:    'عهدة شخصية',
  custody_return:      'إعادة عهدة',
  damage_record:       'سجل تلف',
  central_return:      'إعادة مركزية',
  license:             'ترخيص',
  settings:            'الإعدادات',
};

const DEFAULT_ACTIVITY_META = {
  label: 'نشاط نظامي',
  icon: <Activity className="w-3.5 h-3.5" />,
  color: 'bg-muted text-muted-foreground',
};

const DETAIL_LABELS: Record<string, string> = {
  username: 'المستخدم',
  fullName: 'الاسم',
  name: 'الاسم',
  itemName: 'المادة',
  equipmentName: 'التجهيز',
  role: 'الصلاحية',
  isActive: 'الحالة',
  nodeId: 'العقدة',
  bytes: 'الحجم',
  message: 'الرسالة',
};

function formatActivityValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'مفعّل' : 'غير مفعّل';
  if (typeof value === 'number') return value.toLocaleString('ar-SY');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function formatActivityDetail(entry: AuditEntry): string {
  const details = entry.details ?? {};
  const hiddenKeys = new Set(['nodeId', 'bytes', 'ipAddress', 'userAgent', 'stack', 'error']);
  const preferredKeys = ['name', 'itemName', 'equipmentName', 'fullName', 'username', 'message'];
  const preferred = preferredKeys
    .map(key => [key, details[key]] as const)
    .find(([, value]) => value != null && value !== '');
  const firstDetail = Object.entries(details).find(([key, value]) => !hiddenKeys.has(key) && value != null && value !== '');
  const detail = preferred ?? firstDetail;

  if (detail) {
    const [key, value] = detail;
    const formatted = formatActivityValue(value);
    return `${DETAIL_LABELS[key] ?? 'التفاصيل'}: ${formatted}`;
  }

  return entry.entityId ? `السجل رقم ${entry.entityId.toLocaleString('ar-SY')}` : '';
}


