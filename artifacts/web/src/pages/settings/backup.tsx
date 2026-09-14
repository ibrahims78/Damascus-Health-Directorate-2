import { useState, useEffect, type ReactNode } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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

export function BackupTab() {
  const RESTORE_TIMEOUT_MS = 120_000;
  const [downloading, setDownloading] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreMode, setRestoreMode] = useState<'full' | 'merge'>('merge');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [packageBase64, setPackageBase64] = useState('');
  const [packageSummary, setPackageSummary] = useState<{
    manifest?: { packageType?: string; createdAt?: string; sourceNodeId?: string };
    recordCount?: number;
    changeCount?: number;
    entityTypes?: string[];
  } | null>(null);
  const [preview, setPreview] = useState<{
    token: string;
    report: {
      counts: Record<string, number>;
      records: Array<{ entityType: string; status: string; code?: string }>;
    };
    summary?: {
      manifest?: { packageType?: string; createdAt?: string; sourceNodeId?: string };
      recordCount?: number;
      changeCount?: number;
      entityTypes?: string[];
    };
  } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restorePointId, setRestorePointId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{
    applied: number;
    duplicate: number;
    conflict: number;
    skipped: number;
    restorePointId: string | null;
  } | null>(null);

  const { data: info, isLoading: infoLoading, refetch } = useQuery({
    queryKey: ['backup-info'],
    queryFn: async () => {
      const res = await fetch('/api/backup/info', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب معلومات قاعدة البيانات');
      return res.json() as Promise<Record<string, number>>;
    },
  });

  const handleExport = async () => {
    if (exportPassword.length < 8) {
      toast.error('أدخل كلمة مرور للحزمة من 8 أحرف على الأقل');
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch('/api/backups/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: exportPassword }),
      });
      if (!res.ok) throw new Error('فشل تصدير البيانات');
      const blob = await res.blob();
      const dateStr = new Date().toISOString().split('T')[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `damascus-${dateStr}.dme-sync`;
      a.click();
      URL.revokeObjectURL(url);
      setExportPassword('');
      toast.success('تم تصدير الحزمة المشفرة بنجاح');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setDownloading(false);
    }
  };

  const fileToBase64 = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('تعذر قراءة ملف النسخة'));
      reader.readAsDataURL(file);
    });
    const separator = dataUrl.indexOf(',');
    if (separator < 0) throw new Error('تعذر قراءة محتوى ملف النسخة');
    return dataUrl.slice(separator + 1);
  };

  const withRestoreTimeout = async <T,>(promise: Promise<T>) => {
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error('استغرق فحص الحزمة وقتاً أطول من المتوقع؛ تحقق من الملف وكلمة المرور ثم أعد المحاولة')),
        RESTORE_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };

  const inspectAndPreview = async () => {
    if (!restoreFile) {
      toast.error('اختر ملف .dme-sync أولاً');
      return;
    }
    if (restorePassword.length < 8) {
      toast.error('أدخل كلمة مرور الحزمة');
      return;
    }
    setRestoring(true);
    setPreview(null);
    setRestoreError(null);
    setRestoreResult(null);
    try {
      const encoded = await fileToBase64(restoreFile);
      setPackageBase64(encoded);
      // Dry Run already returns the package summary. Avoid decrypting the same
      // large package twice; this is especially important in Android WebView.
      const previewResponse = await withRestoreTimeout(fetch('/api/backups/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          packageBase64: encoded,
          password: restorePassword,
          mode: restoreMode,
        }),
      }));
      const previewData = (await previewResponse.json()) as typeof preview & { error?: string };
      if (!previewResponse.ok) throw new Error(previewData.error || 'تعذر تنفيذ المعاينة');
      setPackageSummary(previewData.summary ?? null);
      setPreview(previewData as NonNullable<typeof preview>);
      toast.success('تم الفحص والمعاينة؛ لا تزال الاستعادة بحاجة إلى تأكيد صريح');
    } catch (err) {
      setPackageBase64('');
      const message = err instanceof Error ? err.message : 'تعذر فحص الحزمة';
      setRestoreError(message);
      toast.error(message);
    } finally {
      setRestoring(false);
    }
  };

  const requestRestore = () => {
    if (!preview || !packageBase64) return;
    setRestoreConfirmOpen(true);
  };

  const applyRestore = async () => {
    if (!preview || !packageBase64) return;
    setRestoreConfirmOpen(false);
    setRestoring(true);
    setRestoreError(null);
    setRestoreResult(null);
    try {
      const response = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          packageBase64,
          password: restorePassword,
          mode: restoreMode,
          previewToken: preview.token,
          confirm: true,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        restorePointId?: string;
        counts?: { applied?: number; duplicate?: number; conflict?: number; skipped?: number };
      };
      if (!response.ok) throw new Error(result.error || 'فشلت الاستعادة');
      setRestorePointId(result.restorePointId ?? null);
      setRestoreResult({
        applied: result.counts?.applied ?? 0,
        duplicate: result.counts?.duplicate ?? 0,
        conflict: result.counts?.conflict ?? 0,
        skipped: result.counts?.skipped ?? 0,
        restorePointId: result.restorePointId ?? null,
      });
      setPreview(null);
      setPackageBase64('');
      setRestoreFile(null);
      toast.success('تمت الاستعادة ذرياً وحُفظت نقطة تراجع تلقائية');
      await refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشلت الاستعادة';
      setRestoreError(message);
      toast.error(message);
    } finally {
      setRestoring(false);
    }
  };

  const infoRows: [string, string][] = info
    ? [
        ['التصنيفات',        String(info.categories ?? 0)],
        ['المواد والمستهلكات', String(info.items ?? 0)],
        ['التجهيزات',         String(info.equipment ?? 0)],
        ['العمليات (إدخال/إخراج)', String(info.transactions ?? 0)],
        ['الجهات المستلمة',   String(info.recipients ?? 0)],
        ['المستخدمون',        String(info.users ?? 0)],
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Stats card */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-lg">محتويات قاعدة البيانات</h2>
        {infoLoading ? (
          <p className="text-sm text-muted-foreground">جاري التحميل...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {infoRows.map(([label, value]) => (
              <div key={label} className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{Number(value).toLocaleString('ar')}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export card */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-lg flex-shrink-0">
            <Download className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">تصدير نسخة احتياطية</h3>
            <p className="text-sm text-muted-foreground mt-1">
              تُصدَّر حزمة <code>.dme-sync</code> معيارية مضغوطة ومشفرة AES-256-GCM وتستبعد كلمات
              المرور والجلسات. احتفظ بكلمة المرور خارج ملف الحزمة.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            type="password"
            value={exportPassword}
            onChange={(event) => setExportPassword(event.target.value)}
            placeholder="كلمة مرور الحزمة (8 أحرف على الأقل)"
            aria-label="كلمة مرور تصدير الحزمة"
            className="sm:max-w-sm"
          />
          <Button onClick={handleExport} disabled={downloading} className="gap-2">
          <Download className="h-4 w-4" />
            {downloading ? 'جاري التصدير...' : 'تصدير حزمة مشفرة'}
          </Button>
        </div>
      </div>

      {/* Restore card */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-500/10 rounded-lg flex-shrink-0">
            <Upload className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold">فحص واستعادة حزمة</h3>
            <p className="text-sm text-muted-foreground mt-1">
              لا يمكن اعتماد الاستعادة مباشرة: ارفع الحزمة، أدخل كلمة المرور، نفّذ Dry Run، ثم راجع
              النتائج قبل التأكيد. النمط الكامل يستبدل بيانات المستودع بعد حفظ نقطة تراجع.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="file"
            accept=".dme-sync,application/octet-stream"
            onChange={(event) => {
              setRestoreFile(event.target.files?.[0] ?? null);
              setPackageSummary(null);
              setPreview(null);
              setRestoreError(null);
              setRestoreResult(null);
            }}
            aria-label="اختيار حزمة dme-sync"
          />
          <Input
            type="password"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            placeholder="كلمة مرور الحزمة"
            aria-label="كلمة مرور الاستعادة"
          />
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Select value={restoreMode} onValueChange={(value) => setRestoreMode(value as 'full' | 'merge')}>
            <SelectTrigger className="sm:w-56" aria-label="نمط الاستعادة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="merge">دمج آمن — لا يحذف الحالي</SelectItem>
              <SelectItem value="full">استعادة كاملة — استبدال البيانات</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={inspectAndPreview} disabled={restoring} className="gap-2">
            {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {restoring ? 'جاري فك الحزمة وفحصها...' : 'فحص وتنفيذ Dry Run'}
          </Button>
        </div>
        {packageSummary && (
          <div className="rounded-lg bg-muted/40 border p-4 text-sm space-y-1">
            <p className="font-medium">ملخص الحزمة</p>
            <p>النوع: {packageSummary.manifest?.packageType ?? '—'} — السجلات: {packageSummary.recordCount ?? 0} — التغييرات: {packageSummary.changeCount ?? 0}</p>
            <p className="text-muted-foreground">العقدة المصدر: {packageSummary.manifest?.sourceNodeId ?? '—'}</p>
          </div>
        )}
        {preview && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
            <p className="font-medium">نتيجة المعاينة قبل التطبيق</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
              {(['applied', 'duplicate', 'rejected', 'conflict', 'skipped'] as const).map((key) => (
                <div key={key} className="rounded bg-background border p-2">
                  <div className="font-bold text-base">{preview.report.counts[key] ?? 0}</div>
                  <div className="text-muted-foreground">{key}</div>
                </div>
              ))}
            </div>
            {preview.report.records.some((record) => record.status === 'rejected' || record.status === 'conflict') && (
              <p className="text-sm text-destructive">توجد سجلات مرفوضة أو متعارضة؛ لن يسمح الخادم بالتطبيق حتى تصحح الحزمة.</p>
            )}
           <Button onClick={requestRestore} disabled={restoring || (preview.report.counts.rejected ?? 0) > 0} className="gap-2">
              <CheckCircle2 className="h-4 w-4" /> تأكيد وتطبيق الاستعادة
            </Button>
          </div>
        )}
        {restoreError && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-medium">فشلت الاستعادة ولم تُحفظ التغييرات</p>
            <p className="mt-1">{restoreError}</p>
            <p className="mt-2 text-xs">نفّذ الفحص والمعاينة مرة أخرى قبل إعادة المحاولة.</p>
          </div>
        )}
        {restoreResult && (
          <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
            <p className="font-medium">تمت الاستعادة بنجاح</p>
            <p className="mt-1">
              مطبّق: {restoreResult.applied} — مكرر: {restoreResult.duplicate} — متعارض: {restoreResult.conflict} — متجاوز: {restoreResult.skipped}
            </p>
          </div>
        )}
        {restorePointId && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            تم حفظ نقطة التراجع تلقائياً: <code>{restorePointId}</code>
          </p>
        )}
      </div>

      {/* Info card */}
      <div className="bg-muted/30 border border-dashed rounded-lg p-5 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <p className="text-sm font-medium">توصيات النسخ الاحتياطي</p>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1.5 pr-6 list-disc">
          <li>قم بتصدير نسخة احتياطية أسبوعياً على الأقل</li>
          <li>احفظ الملف على قرص خارجي أو مشاركة شبكية</li>
           <li>اختبر الحزمة في بيئة اختبار قبل استخدامها على الإنتاج</li>
           <li>احتفظ بكلمة المرور في مدير أسرار منفصل، ولا ترسلها مع الملف</li>
           <li>كل استعادة تنشئ نقطة تراجع وتقريراً قابلاً للمراجعة</li>
        </ul>
      </div>

      <AlertDialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تطبيق الاستعادة</AlertDialogTitle>
            <AlertDialogDescription>
              ستُطبّق نتيجة المعاينة على قاعدة البيانات، وستُحفظ نقطة تراجع تلقائية. لا تتابع إلا بعد مراجعة عدد السجلات والتعارضات.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => void applyRestore()} disabled={restoring}>
              متابعة الاستعادة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

// ─── Categories Tab ───────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
  type: 'consumable' | 'equipment';
}

