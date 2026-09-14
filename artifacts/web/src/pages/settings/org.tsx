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
  Monitor,
  Network,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/copy-button';
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
  data: Partial<Pick<SystemSettings, 'orgName' | 'expiryAlertDays' | 'unitsList' | 'technicalConditions' | 'returnConditions'>>,
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

export function OrgTab() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });

  const [orgName, setOrgName]         = useState('');
  const [expiryAlertDays, setDays]    = useState('30');

  useEffect(() => {
    if (settings) {
      setOrgName(settings.orgName);
      setDays(String(settings.expiryAlertDays));
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('تم حفظ الإعدادات');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="bg-card border rounded-lg p-6 space-y-5">
      <h2 className="font-semibold text-lg">إعدادات المستودع</h2>

      <div className="space-y-1.5">
        <Label htmlFor="orgName">اسم المستودع <span className="text-destructive">*</span></Label>
        <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)}
        placeholder="مستودعات مديرية صحة دمشق" />
        <p className="text-xs text-muted-foreground">يظهر في رأس سندات الإدخال والإخراج</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expiryDays">
          أيام التنبيه قبل انتهاء الصلاحية <span className="text-destructive">*</span>
        </Label>
        <div className="flex items-center gap-3">
          <Input id="expiryDays" type="number" min={1} max={365} value={expiryAlertDays}
            onChange={(e) => setDays(e.target.value)} className="w-28" dir="ltr" />
          <span className="text-sm text-muted-foreground">يوماً</span>
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5" aria-labelledby="browser-access-title">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Network className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 id="browser-access-title" className="font-semibold">الدخول إلى التطبيق من المستعرض</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              تعمل نسخة Windows كخادم محلي، ويمكن فتحها من نفس الجهاز أو من أجهزة أخرى ضمن الشبكة المحلية.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-background/80 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Monitor className="h-4 w-4 text-primary" aria-hidden="true" />
              من نفس الجهاز
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              افتح العنوان التالي في Chrome أو Edge على جهاز Windows الذي يشغّل التطبيق:
            </p>
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5" dir="ltr">
              <code className="min-w-0 break-all text-sm font-semibold text-foreground">http://localhost:41790</code>
              <CopyButton value="http://localhost:41790" label="عنوان الدخول المحلي" className="shrink-0" />
            </div>
          </div>

          <div className="rounded-lg border bg-background/80 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Network className="h-4 w-4 text-primary" aria-hidden="true" />
              من جهاز آخر على الشبكة
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              استبدل عنوان IP بعنوان الجهاز المضيف، وتأكد من اتصال الجهازين بالشبكة نفسها.
            </p>
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5" dir="ltr">
              <code className="min-w-0 break-all text-sm font-semibold text-foreground">http://192.168.1.25:41790</code>
              <CopyButton value="http://192.168.1.25:41790" label="عنوان الدخول عبر الشبكة" className="shrink-0" />
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              المثال السابق يفترض أن عنوان الجهاز المضيف هو <span dir="ltr" className="font-semibold">192.168.1.25</span>.
              اعرف العنوان الصحيح من أمر <code dir="ltr">ipconfig</code>.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs leading-5 text-amber-950 dark:text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            لنسخة Windows استخدم المنفذ <code dir="ltr" className="font-semibold">41790</code>.
            لا تستخدم المنفذ <code dir="ltr" className="font-semibold">5000</code>؛ فهو مخصص لبيئة التطوير في Replit.
            يجب السماح بالمنفذ في جدار حماية Windows عند الحاجة إلى الدخول من جهاز آخر.
          </p>
        </div>
      </section>

      <div className="flex justify-end pt-2">
        <Button onClick={() => mutation.mutate({ orgName, expiryAlertDays: Number(expiryAlertDays) })}
          disabled={mutation.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          {mutation.isPending ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
        </Button>
      </div>
    </div>
  );
}

// ─── Units Tab ────────────────────────────────────────────────────────────────

