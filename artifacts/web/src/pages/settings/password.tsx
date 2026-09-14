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

function calcStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 1) return { score: 1, label: 'ضعيفة جداً',  color: 'bg-destructive' };
  if (score === 2) return { score: 2, label: 'ضعيفة',       color: 'bg-orange-500' };
  if (score === 3) return { score: 3, label: 'متوسطة',      color: 'bg-amber-500'  };
  if (score === 4) return { score: 4, label: 'جيدة',        color: 'bg-blue-500'   };
  return              { score: 5, label: 'قوية جداً',   color: 'bg-green-500'  };
}

// ─── Password Tab ─────────────────────────────────────────────────────────────

export function PasswordTab() {
  const [current, setCurrent]   = useState('');
  const [next, setNext]         = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showCur, setShowCur]   = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showCnf, setShowCnf]   = useState(false);

  const strength = calcStrength(next);
  const mismatch = confirm.length > 0 && next !== confirm;

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.success('تم تغيير كلمة المرور بنجاح');
      setCurrent(''); setNext(''); setConfirm('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSave = () => {
    if (!current || !next || !confirm) { toast.error('يرجى تعبئة جميع الحقول'); return; }
    if (
      next.length < 12 ||
      !/[A-Z]/.test(next) ||
      !/[a-z]/.test(next) ||
      !/[0-9]/.test(next) ||
      !/[^A-Za-z0-9]/.test(next)
    ) {
      toast.error('يجب أن تحتوي كلمة المرور على 12 حرفاً، وحرف كبير وصغير ورقم ورمز');
      return;
    }
    if (next !== confirm)  { toast.error('كلمتا المرور غير متطابقتين'); return; }
    mutation.mutate({ currentPassword: current, newPassword: next });
  };

  return (
    <div className="bg-card border rounded-xl p-6 space-y-5 max-w-sm">
      <div>
        <h2 className="font-semibold text-lg">تغيير كلمة المرور</h2>
        <p className="text-xs text-muted-foreground mt-0.5">12 حرفاً على الأقل، مع حرف كبير وصغير ورقم ورمز</p>
      </div>

      {/* Current password */}
      <div className="space-y-1.5">
        <Label htmlFor="cur">كلمة المرور الحالية</Label>
        <div className="relative">
          <Input
            id="cur"
            type={showCur ? 'text' : 'password'}
            value={current}
            onChange={e => setCurrent(e.target.value)}
            className="pl-10"
          />
          <button
            type="button"
            onClick={() => setShowCur(v => !v)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCur ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* New password + strength */}
      <div className="space-y-1.5">
        <Label htmlFor="nxt">كلمة المرور الجديدة</Label>
        <div className="relative">
          <Input
            id="nxt"
            type={showNext ? 'text' : 'password'}
            value={next}
            onChange={e => setNext(e.target.value)}
            className="pl-10"
          />
          <button
            type="button"
            onClick={() => setShowNext(v => !v)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {/* Strength bar */}
        {next && (
          <div className="space-y-1 pt-0.5">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    i <= strength.score ? strength.color : 'bg-muted'
                  }`}
                />
              ))}
            </div>
            <p className={`text-xs font-medium transition-colors ${
              strength.score <= 2 ? 'text-destructive' :
              strength.score === 3 ? 'text-amber-600 dark:text-amber-400' :
              'text-green-600 dark:text-green-400'
            }`}>
              {strength.label}
              <span className="text-muted-foreground font-normal mr-1.5">
                — أضف {[
                  next.length < 12 && 'المزيد من الأحرف',
                  !/[A-Z]/.test(next) && 'حرف كبير',
                  !/[a-z]/.test(next) && 'حرف صغير',
                  !/[0-9]/.test(next) && 'رقم',
                  !/[^A-Za-z0-9]/.test(next) && 'رمز (!@#...)',
                ].filter(Boolean).join('، ')}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Confirm */}
      <div className="space-y-1.5">
        <Label htmlFor="cnf">تأكيد كلمة المرور</Label>
        <div className="relative">
          <Input
            id="cnf"
            type={showCnf ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className={`pl-10 ${mismatch ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          <button
            type="button"
            onClick={() => setShowCnf(v => !v)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showCnf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {mismatch && (
          <p className="text-xs text-destructive">كلمتا المرور غير متطابقتين</p>
        )}
      </div>

      <Button
        onClick={handleSave}
        disabled={mutation.isPending || !current || !next || !confirm || mismatch || strength.score < 5}
        className="gap-2 w-full"
      >
        <Save className="h-4 w-4" />
        {mutation.isPending ? 'جاري الحفظ...' : 'حفظ كلمة المرور'}
      </Button>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const ACT_META: Record<string, { label: string; icon: ReactNode; color: string }> = {
  login:           { label: 'دخول للنظام',   icon: <LogIn className="w-3.5 h-3.5" />,              color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  logout:          { label: 'خروج',           icon: <LogOutIcon className="w-3.5 h-3.5" />,         color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  create:          { label: 'إضافة',          icon: <Plus className="w-3.5 h-3.5" />,               color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  update:          { label: 'تعديل',          icon: <Pencil className="w-3.5 h-3.5" />,             color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  delete:          { label: 'حذف',            icon: <Trash2 className="w-3.5 h-3.5" />,             color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  transaction_in:  { label: 'إدخال مواد',    icon: <ArrowDownToLine className="w-3.5 h-3.5" />,    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  transaction_out: { label: 'إخراج مواد',    icon: <ArrowUpFromLine className="w-3.5 h-3.5" />,    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
};

const ENTITY_AR: Record<string, string> = {
  item:        'مادة',
  equipment:   'تجهيزة',
  transaction: 'عملية',
  user:        'مستخدم',
  category:    'تصنيف',
};

