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

export function TechnicalConditionsTab() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [conditions, setConditions] = useState<TechnicalCondition[]>(DEFAULT_TECHNICAL_CONDITIONS);
  const [newLabel, setNewLabel] = useState('');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [returnConditions, setReturnConditions] = useState(DEFAULT_RETURN_CONDITIONS);
  const [newReturnLabel, setNewReturnLabel] = useState('');
  const [newReturnBehavior, setNewReturnBehavior] = useState('damaged');
  const [editReturnKey, setEditReturnKey] = useState<string | null>(null);
  const [editReturnLabel, setEditReturnLabel] = useState('');
  const [editReturnBehavior, setEditReturnBehavior] = useState('damaged');

  useEffect(() => {
    if (settings?.technicalConditions) {
      try {
        const parsed = JSON.parse(settings.technicalConditions);
        if (
          Array.isArray(parsed) &&
          parsed.every(
            (condition) =>
              condition &&
              typeof condition.key === 'string' &&
              typeof condition.label === 'string',
          )
        ) {
          setConditions(parsed);
        }
      } catch { /* keep defaults */ }
    }
    if (settings?.returnConditions) {
      try {
        const parsed = JSON.parse(settings.returnConditions);
        if (Array.isArray(parsed) && parsed.every((item) => item && typeof item.key === 'string' && typeof item.label === 'string' && typeof item.behavior === 'string')) {
          setReturnConditions(parsed);
        }
      } catch { /* keep defaults */ }
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (next: TechnicalCondition[]) =>
      saveSettings({ technicalConditions: JSON.stringify(next) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (error: Error) => toast.error(error.message),
  });
  const returnMutation = useMutation({
    mutationFn: (next: typeof DEFAULT_RETURN_CONDITIONS) =>
      saveSettings({ returnConditions: JSON.stringify(next) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const persist = (next: TechnicalCondition[], message: string) => {
    mutation.mutate(next, {
      onSuccess: () => {
        setConditions(next);
        setEditKey(null);
        setEditValue('');
        toast.success(message);
      },
    });
  };

  const isDuplicate = (label: string, exceptKey?: string) =>
    conditions.some(
      (condition) =>
        condition.key !== exceptKey &&
        condition.label.localeCompare(label, 'ar', { sensitivity: 'base' }) === 0,
    );

  const addCondition = () => {
    const label = newLabel.trim();
    if (!label) return;
    if (isDuplicate(label)) {
      toast.error('الحالة الفنية موجودة مسبقاً');
      return;
    }
    const key = `technical_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    persist([...conditions, { key, label }], 'تمت إضافة الحالة الفنية');
    setNewLabel('');
  };

  const saveEdit = () => {
    if (!editKey) return;
    const label = editValue.trim();
    if (!label) {
      toast.error('اسم الحالة الفنية مطلوب');
      return;
    }
    if (isDuplicate(label, editKey)) {
      toast.error('الحالة الفنية موجودة مسبقاً');
      return;
    }
    persist(
      conditions.map((condition) =>
        condition.key === editKey ? { ...condition, label } : condition,
      ),
      'تم تعديل الحالة الفنية',
    );
  };

  const removeCondition = (key: string) => {
    if (conditions.length <= 1) {
      toast.error('يجب الإبقاء على حالة فنية واحدة على الأقل');
      return;
    }
    persist(
      conditions.filter((condition) => condition.key !== key),
      'تم حذف الحالة الفنية',
    );
  };

  const saveReturnConditions = (next: typeof DEFAULT_RETURN_CONDITIONS, message: string) => {
    returnMutation.mutate(next, {
      onSuccess: () => {
        setReturnConditions(next);
        setEditReturnKey(null);
        toast.success(message);
      },
    });
  };
  const addReturnCondition = () => {
    const label = newReturnLabel.trim();
    if (!label || returnConditions.some((item) => item.label.localeCompare(label, 'ar', { sensitivity: 'base' }) === 0)) {
      toast.error(label ? 'حالة الإعادة موجودة مسبقاً' : 'اسم الحالة مطلوب');
      return;
    }
    const key = `return_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    saveReturnConditions([...returnConditions, { key, label, behavior: newReturnBehavior }], 'تمت إضافة حالة الإعادة');
    setNewReturnLabel('');
  };
  const saveReturnEdit = () => {
    if (!editReturnKey || !editReturnLabel.trim()) return;
    if (returnConditions.some((item) => item.key !== editReturnKey && item.label.localeCompare(editReturnLabel.trim(), 'ar', { sensitivity: 'base' }) === 0)) {
      toast.error('حالة الإعادة موجودة مسبقاً');
      return;
    }
    saveReturnConditions(
      returnConditions.map((item) => item.key === editReturnKey ? { ...item, label: editReturnLabel.trim(), behavior: editReturnBehavior } : item),
      'تم تعديل حالة الإعادة',
    );
  };

  return (
    <div className="bg-card border rounded-lg p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-lg">الحالات الفنية</h2>
        <p className="text-sm text-muted-foreground mt-1">
          الحالات المتاحة عند إضافة أو تعديل التجهيزات
        </p>
      </div>

      <div className="flex gap-2 max-w-xl">
        <Input
          placeholder="أضف حالة فنية جديدة..."
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addCondition()}
        />
        <Button
          onClick={addCondition}
          disabled={!newLabel.trim() || mutation.isPending}
          className="gap-2 flex-shrink-0"
        >
          <Plus className="h-4 w-4" />
          إضافة
        </Button>
      </div>

      <div className="space-y-2">
        {conditions.map((condition) => (
          <div
            key={condition.key}
            className="flex items-center gap-2 rounded-md border bg-secondary/40 px-3 py-2"
          >
            {editKey === condition.key ? (
              <>
                <Input
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveEdit();
                    if (event.key === 'Escape') {
                      setEditKey(null);
                      setEditValue('');
                    }
                  }}
                  className="h-8 flex-1 bg-background"
                  autoFocus
                  aria-label={`تعديل الحالة ${condition.label}`}
                />
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={mutation.isPending}
                  className="text-primary hover:text-primary/80 disabled:opacity-50"
                  title="حفظ التعديل"
                  aria-label="حفظ التعديل"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditKey(null);
                    setEditValue('');
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="إلغاء التعديل"
                  aria-label="إلغاء التعديل"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 font-medium">{condition.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditKey(condition.key);
                    setEditValue(condition.label);
                  }}
                  disabled={mutation.isPending}
                  className="text-muted-foreground hover:text-primary disabled:opacity-50"
                  title={`تعديل ${condition.label}`}
                  aria-label={`تعديل ${condition.label}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => removeCondition(condition.key)}
                  disabled={mutation.isPending}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  title={`حذف ${condition.label}`}
                  aria-label={`حذف ${condition.label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {conditions.length} حالات مسجّلة — تعديل الاسم يحدّث العرض، ولا يغيّر السجلات المحفوظة
      </p>

      <div className="border-t pt-6 space-y-4">
        <div>
          <h3 className="font-semibold">حالات الصنف عند الإعادة والمرتجع</h3>
          <p className="text-sm text-muted-foreground mt-1">
            هذه القائمة تظهر في خانتي «حالة الصنف عند الإعادة» و«حالة المرتجع». التأثير التشغيلي يحدد كيفية معالجة الرصيد.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <Label>اسم الحالة</Label>
            <Input value={newReturnLabel} onChange={(e) => setNewReturnLabel(e.target.value)} placeholder="مثال: يحتاج تنظيف" />
          </div>
          <div className="w-52 space-y-1">
            <Label>التأثير التشغيلي</Label>
            <Select value={newReturnBehavior} onValueChange={setNewReturnBehavior}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="good">جيد</SelectItem>
                <SelectItem value="damaged">تالف</SelectItem>
                <SelectItem value="needs_maintenance">يحتاج صيانة</SelectItem>
                <SelectItem value="missing">مفقود</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addReturnCondition} disabled={!newReturnLabel.trim() || returnMutation.isPending} className="gap-2"><Plus className="h-4 w-4" />إضافة</Button>
        </div>
        <div className="space-y-2">
          {returnConditions.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-2 rounded-md border bg-secondary/40 px-3 py-2">
              {editReturnKey === item.key ? (
                <>
                  <Input className="h-8 flex-1 min-w-[180px]" value={editReturnLabel} onChange={(e) => setEditReturnLabel(e.target.value)} />
                  <Select value={editReturnBehavior} onValueChange={setEditReturnBehavior}><SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">جيد</SelectItem><SelectItem value="damaged">تالف</SelectItem><SelectItem value="needs_maintenance">يحتاج صيانة</SelectItem><SelectItem value="missing">مفقود</SelectItem></SelectContent></Select>
                  <Button size="sm" onClick={saveReturnEdit} disabled={returnMutation.isPending}><Save className="h-3.5 w-3.5" />حفظ</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditReturnKey(null)}><X className="h-3.5 w-3.5" /></Button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium text-sm">{item.label}</span>
                  <Badge variant="outline">{item.behavior === 'good' ? 'جيد' : item.behavior === 'damaged' ? 'تالف' : item.behavior === 'needs_maintenance' ? 'يحتاج صيانة' : 'مفقود'}</Badge>
                  <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل" onClick={() => { setEditReturnKey(item.key); setEditReturnLabel(item.label); setEditReturnBehavior(item.behavior); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="حذف" disabled={returnConditions.length <= 1} onClick={() => saveReturnConditions(returnConditions.filter((entry) => entry.key !== item.key), 'تم حذف حالة الإعادة')}><Trash2 className="h-3.5 w-3.5" /></Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Backup Tab ───────────────────────────────────────────────────────────────


interface TechnicalCondition {
  key: string;
  label: string;
}


