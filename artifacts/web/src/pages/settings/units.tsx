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

export function UnitsTab() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });

  const [units, setUnits] = useState<string[]>(DEFAULT_UNITS);
  const [newUnit, setNewUnit] = useState('');
  const [editUnit, setEditUnit] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (settings?.unitsList) {
      try {
        const parsed = JSON.parse(settings.unitsList);
        if (Array.isArray(parsed) && parsed.every((unit) => typeof unit === 'string')) {
          setUnits(parsed);
        }
      } catch { /* keep defaults */ }
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (u: string[]) => saveSettings({ unitsList: JSON.stringify(u) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const persistUnits = (nextUnits: string[], successMessage: string) => {
    mutation.mutate(nextUnits, {
      onSuccess: () => {
        setUnits(nextUnits);
        setEditUnit(null);
        setEditValue('');
        toast.success(successMessage);
      },
    });
  };

  const addUnit = () => {
    const trimmed = newUnit.trim();
    if (!trimmed) return;
    if (units.some((unit) => unit.localeCompare(trimmed, 'ar', { sensitivity: 'base' }) === 0)) {
      toast.error('الوحدة موجودة مسبقاً');
      return;
    }
    const updated = [...units, trimmed];
    setNewUnit('');
    persistUnits(updated, 'تمت إضافة وحدة القياس');
  };

  const removeUnit = (u: string) => {
    if (units.length <= 1) {
      toast.error('يجب الإبقاء على وحدة قياس واحدة على الأقل');
      return;
    }
    const updated = units.filter((x) => x !== u);
    persistUnits(updated, 'تم حذف وحدة القياس');
  };

  const startEdit = (unit: string) => {
    setEditUnit(unit);
    setEditValue(unit);
  };

  const saveEdit = () => {
    if (!editUnit) return;
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error('اسم الوحدة مطلوب');
      return;
    }
    if (
      units.some(
        (unit) =>
          unit !== editUnit &&
          unit.localeCompare(trimmed, 'ar', { sensitivity: 'base' }) === 0,
      )
    ) {
      toast.error('الوحدة موجودة مسبقاً');
      return;
    }
    persistUnits(
      units.map((unit) => (unit === editUnit ? trimmed : unit)),
      'تم تعديل وحدة القياس',
    );
  };

  return (
    <div className="bg-card border rounded-lg p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-lg">وحدات القياس</h2>
        <p className="text-sm text-muted-foreground mt-1">
          الوحدات المتاحة عند إضافة مواد جديدة
        </p>
      </div>

      {/* Add new unit */}
      <div className="flex gap-2 max-w-sm">
        <Input
          placeholder="أضف وحدة جديدة..."
          value={newUnit}
          onChange={(e) => setNewUnit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addUnit()}
        />
        <Button onClick={addUnit} className="gap-2 flex-shrink-0">
          <Plus className="h-4 w-4" />
          إضافة
        </Button>
      </div>

      {/* Units list */}
      <div className="flex flex-wrap gap-2">
        {units.map((u) => (
          <span
            key={u}
            className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground px-2 py-1 rounded-full text-sm font-medium"
          >
            {editUnit === u ? (
              <>
                <Input
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveEdit();
                    if (event.key === 'Escape') {
                      setEditUnit(null);
                      setEditValue('');
                    }
                  }}
                  className="h-7 w-28 bg-background px-2 text-sm"
                  autoFocus
                  aria-label={`تعديل الوحدة ${u}`}
                />
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={mutation.isPending}
                  className="text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  title="حفظ تعديل الوحدة"
                  aria-label="حفظ تعديل الوحدة"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditUnit(null);
                    setEditValue('');
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="إلغاء تعديل الوحدة"
                  aria-label="إلغاء تعديل الوحدة"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <span>{u}</span>
                <button
                  type="button"
                  onClick={() => startEdit(u)}
                  disabled={mutation.isPending}
                  className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                  title={`تعديل ${u}`}
                  aria-label={`تعديل ${u}`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => removeUnit(u)}
                  disabled={mutation.isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  title={`حذف ${u}`}
                  aria-label={`حذف ${u}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            )}
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {units.length} وحدة مسجّلة — التغييرات تُحفظ فوراً، ولا يؤثر حذف/تعديل الخيار على المواد المحفوظة سابقاً
      </p>
    </div>
  );
}

// ─── Technical Conditions Tab ──────────────────────────────────────────────────

interface TechnicalCondition {
  key: string;
  label: string;
}

