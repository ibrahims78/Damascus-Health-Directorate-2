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

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  admin:             { label: 'مدير نظام',    color: 'text-primary',     bg: 'bg-primary' },
  warehouse_manager: { label: 'أمين مستودع', color: 'text-amber-600',    bg: 'bg-amber-500' },
  viewer:            { label: 'مراقب',        color: 'text-slate-500',    bg: 'bg-slate-400' },
};

function getInitials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('');
}

export function ProfileTab({
  user,
}: {
  user?: { id?: number; fullName?: string; username?: string; role?: string } | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    if (user?.fullName) setNameInput(user.fullName);
  }, [user?.fullName]);

  const updateMutation = useMutation({
    mutationFn: async (fullName: string) => {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fullName }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'فشل تحديث الاسم');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      toast.success('تم تحديث الاسم بنجاح');
      setEditing(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const roleMeta = ROLE_META[user?.role ?? ''] ?? ROLE_META.viewer;

  return (
    <div className="space-y-4">
      {/* Identity card */}
      <div className="bg-card border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Avatar */}
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shrink-0 shadow-md ${roleMeta.bg}`}>
            {getInitials(user?.fullName)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 space-y-1">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  className="h-9 text-lg font-semibold max-w-xs"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') updateMutation.mutate(nameInput.trim());
                    if (e.key === 'Escape') setEditing(false);
                  }}
                />
                <Button
                  size="sm"
                  className="gap-1.5 h-9"
                  onClick={() => updateMutation.mutate(nameInput.trim())}
                  disabled={updateMutation.isPending || !nameInput.trim()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {updateMutation.isPending ? 'جاري الحفظ...' : 'حفظ'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={() => { setEditing(false); setNameInput(user?.fullName ?? ''); }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold truncate">{user?.fullName || '—'}</h2>
                <button
                  onClick={() => setEditing(true)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
                  title="تعديل الاسم"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-sm text-muted-foreground font-mono">@{user?.username}</span>
              <Badge
                variant="secondary"
                className={`text-xs font-medium ${roleMeta.color}`}
              >
                <ShieldCheck className="h-3 w-3 mr-1" />
                {roleMeta.label}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Account details */}
      <div className="bg-card border rounded-xl p-6">
        <h3 className="font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wider">
          تفاصيل الحساب
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">الاسم الكامل</Label>
            <p className="font-medium">{user?.fullName || '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">اسم المستخدم</Label>
            <p className="font-mono text-sm bg-muted/50 rounded px-2 py-1 inline-block">{user?.username || '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">مستوى الصلاحية</Label>
            <p className={`font-medium ${roleMeta.color}`}>{roleMeta.label}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground border-t pt-4 mt-4">
          يمكنك تعديل اسمك الكامل بالضغط على أيقونة القلم. لتغيير الدور أو اسم المستخدم تواصل مع مدير النظام.
        </p>
      </div>
    </div>
  );
}

// ─── Password strength ────────────────────────────────────────────────────────

