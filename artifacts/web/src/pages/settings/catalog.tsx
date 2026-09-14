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

export function CategoriesTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'consumable' | 'equipment'>('consumable');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'consumable' | 'equipment'>('consumable');
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ['categories-settings'],
    queryFn: async () => {
      const res = await fetch('/api/categories', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب التصنيفات');
      return res.json();
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories-settings'] });
    qc.invalidateQueries({ queryKey: ['listCategories'] });
    qc.invalidateQueries({ queryKey: ['/api/categories'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; type: string }) => {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; throw new Error(e.error || 'خطأ'); }
      return res.json();
    },
    onSuccess: () => { invalidate(); setNewName(''); toast.success('تم إضافة التصنيف'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, type }: { id: number; name: string; type: 'consumable' | 'equipment' }) => {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; throw new Error(e.error || 'خطأ'); }
      return res.json();
    },
    onSuccess: () => { invalidate(); setEditId(null); toast.success('تم تعديل التصنيف'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; throw new Error(e.error || 'خطأ'); }
    },
    onSuccess: () => { invalidate(); toast.success('تم حذف التصنيف'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const typeLabel = { consumable: 'مستهلكات', equipment: 'تجهيزات' };
  const consumable = categories.filter((c) => c.type === 'consumable');
  const equipment  = categories.filter((c) => c.type === 'equipment');

  return (
    <div className="space-y-6">
      {/* Add new */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-lg">إضافة تصنيف جديد</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5 flex-1 min-w-[180px]">
            <Label htmlFor="cat-name-s">اسم التصنيف</Label>
            <Input
              id="cat-name-s"
              placeholder="مثال: مستهلكات طبية، أدوية..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createMutation.mutate({ name: newName.trim(), type: newType })}
            />
          </div>
          <div className="space-y-1.5 w-40">
            <Label>النوع</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v as 'consumable' | 'equipment')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="consumable">مستهلكات (مواد)</SelectItem>
                <SelectItem value="equipment">تجهيزات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => newName.trim() && createMutation.mutate({ name: newName.trim(), type: newType })}
            disabled={!newName.trim() || createMutation.isPending}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="bg-card border rounded-lg divide-y">
        <div className="px-5 py-3 bg-muted/40 flex items-center gap-2">
          <Tag className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">
            التصنيفات المسجّلة ({categories.length})
          </span>
        </div>

        {isLoading ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">جاري التحميل...</div>
        ) : categories.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            لا توجد تصنيفات بعد — أضف واحداً من الأعلى
          </div>
        ) : (
          [
            { label: 'مستهلكات (مواد)', items: consumable },
            { label: 'تجهيزات', items: equipment },
          ].map(({ label, items }) =>
            items.length === 0 ? null : (
              <div key={label}>
                <div className="px-5 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20">
                  {label}
                </div>
                {items.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                    {editId === cat.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') updateMutation.mutate({ id: cat.id, name: editName, type: editType });
                            if (e.key === 'Escape') setEditId(null);
                          }}
                        />
                        <Select value={editType} onValueChange={(value) => setEditType(value as 'consumable' | 'equipment')}>
                          <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="consumable">مستهلكات (مواد)</SelectItem>
                            <SelectItem value="equipment">تجهيزات</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-8 gap-1" onClick={() => updateMutation.mutate({ id: cat.id, name: editName, type: editType })} disabled={updateMutation.isPending}>
                          <Save className="w-3.5 h-3.5" />حفظ
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 font-medium text-sm">{cat.name}</span>
                        <span className="text-xs text-muted-foreground">{typeLabel[cat.type]}</span>
                         <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل" onClick={() => { setEditId(cat.id); setEditName(cat.name); setEditType(cat.type); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="حذف"
                           onClick={() => setDeleteTarget(cat)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )
          )
        )}
      </div>
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التصنيف؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيُحذف التصنيف «{deleteTarget?.name}» إذا لم يكن مستخدمًا. إذا كان مرتبطًا بمواد سيعرض النظام سبب المنع دون حذف البيانات.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              حذف التصنيف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Recipient list tab ───────────────────────────────────────────────────────

interface ManagedRecipient {
  id: number;
  name: string;
  notes?: string | null;
  isActive: boolean;
}

export function RecipientsTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const { data: recipients = [], isLoading } = useQuery<ManagedRecipient[]>({
    queryKey: ['recipients-settings'],
    queryFn: async () => {
      const res = await fetch('/api/recipients?includeInactive=true', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب الجهات المستلمة');
      return res.json();
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recipients-settings'] });
    qc.invalidateQueries({ queryKey: ['listRecipients'] });
    qc.invalidateQueries({ queryKey: ['/api/recipients'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: number; name: string; notes?: string }) => {
      const res = await fetch(data.id ? `/api/recipients/${data.id}` : '/api/recipients', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: data.name.trim(), notes: data.notes?.trim() || null }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || 'فشل حفظ الجهة');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidate();
      if (variables.id) {
        setEditId(null);
        toast.success('تم تعديل الجهة المستلمة');
      } else {
        setNewName('');
        setNewNotes('');
        toast.success('تمت إضافة الجهة المستلمة');
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/recipients/${id}/toggle`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || 'فشل تغيير حالة الجهة');
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast.success('تم تحديث حالة الجهة');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">إدارة الجهات المستلمة</h2>
          <p className="text-sm text-muted-foreground mt-1">
            هذه القائمة تظهر في نماذج إخراج المواد وتسليم العهد. التعطيل يحافظ على السجلات السابقة ولا يحذفها.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="recipient-name">اسم الجهة *</Label>
            <Input
              id="recipient-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newName.trim()) {
                  saveMutation.mutate({ name: newName, notes: newNotes });
                }
              }}
              placeholder="مثال: مستودع المزة الفرعي"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recipient-notes">ملاحظات (اختياري)</Label>
            <Input id="recipient-notes" value={newNotes} onChange={(event) => setNewNotes(event.target.value)} />
          </div>
          <Button
            onClick={() => newName.trim() && saveMutation.mutate({ name: newName, notes: newNotes })}
            disabled={!newName.trim() || saveMutation.isPending}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />إضافة
          </Button>
        </div>
      </div>

      <div className="bg-card border rounded-lg divide-y">
        <div className="px-5 py-3 bg-muted/40 flex items-center gap-2">
          <UsersRound className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">الجهات المسجّلة ({recipients.length})</span>
        </div>
        {isLoading ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">جاري التحميل...</div>
        ) : recipients.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">لا توجد جهات بعد</div>
        ) : recipients.map((recipient) => (
          <div key={recipient.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
            {editId === recipient.id ? (
              <div className="grid flex-1 min-w-[260px] gap-2 md:grid-cols-2">
                <Input value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus />
                <Input value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="ملاحظات" />
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <p className={`font-medium text-sm ${!recipient.isActive ? 'text-muted-foreground line-through' : ''}`}>
                  {recipient.name}
                </p>
                {recipient.notes && <p className="text-xs text-muted-foreground mt-0.5">{recipient.notes}</p>}
              </div>
            )}
            <Badge variant={recipient.isActive ? 'secondary' : 'outline'} className="shrink-0">
              {recipient.isActive ? 'نشطة' : 'معطّلة'}
            </Badge>
            {editId === recipient.id ? (
              <>
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => editName.trim() && saveMutation.mutate({ id: recipient.id, name: editName, notes: editNotes })}
                  disabled={!editName.trim() || saveMutation.isPending}
                >
                  <Save className="w-3.5 h-3.5" />حفظ
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditId(null)}>إلغاء</Button>
              </>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title="تعديل الجهة"
                  onClick={() => { setEditId(recipient.id); setEditName(recipient.name); setEditNotes(recipient.notes ?? ''); }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  onClick={() => toggleMutation.mutate(recipient.id)}
                  disabled={toggleMutation.isPending}
                >
                  <Power className="w-3.5 h-3.5" />{recipient.isActive ? 'تعطيل' : 'تفعيل'}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Exit reason list tab ──────────────────────────────────────────────────────

interface ManagedExitReason {
  id: number;
  name: string;
  isSystem: boolean;
  isActive: boolean;
}

export function ExitReasonsTab() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const { data: reasons = [], isLoading } = useQuery<ManagedExitReason[]>({
    queryKey: ['exit-reasons-settings'],
    queryFn: async () => {
      const res = await fetch('/api/exit-reasons?includeInactive=true', { credentials: 'include' });
      if (!res.ok) throw new Error('فشل جلب أسباب الإخراج');
      return res.json();
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['exit-reasons-settings'] });
    qc.invalidateQueries({ queryKey: ['listExitReasons'] });
    qc.invalidateQueries({ queryKey: ['/api/exit-reasons'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: number; name: string }) => {
      const res = await fetch(data.id ? `/api/exit-reasons/${data.id}` : '/api/exit-reasons', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: data.name.trim() }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || 'فشل حفظ سبب الإخراج');
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidate();
      if (variables.id) {
        setEditId(null);
        toast.success('تم تعديل سبب الإخراج');
      } else {
        setNewName('');
        toast.success('تمت إضافة سبب الإخراج');
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/exit-reasons/${id}/toggle`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || 'فشل تغيير حالة السبب');
      }
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast.success('تم تحديث حالة سبب الإخراج');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">إدارة أسباب الإخراج</h2>
          <p className="text-sm text-muted-foreground mt-1">
            الأسباب النشطة فقط تظهر في نموذج إخراج المواد. الأسباب الافتراضية محمية لضمان سلامة التقارير والسجلات.
          </p>
        </div>
        <div className="flex gap-3 items-end max-w-xl">
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="exit-reason-name">اسم السبب *</Label>
            <Input
              id="exit-reason-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && newName.trim() && saveMutation.mutate({ name: newName })}
              placeholder="مثال: صرف لمهمة ميدانية"
            />
          </div>
          <Button onClick={() => newName.trim() && saveMutation.mutate({ name: newName })} disabled={!newName.trim() || saveMutation.isPending} className="gap-2">
            <Plus className="h-4 w-4" />إضافة
          </Button>
        </div>
      </div>

      <div className="bg-card border rounded-lg divide-y">
        <div className="px-5 py-3 bg-muted/40 flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-sm">الأسباب المسجّلة ({reasons.length})</span>
        </div>
        {isLoading ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">جاري التحميل...</div>
        ) : reasons.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">لا توجد أسباب بعد</div>
        ) : reasons.map((reason) => (
          <div key={reason.id} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
            {editId === reason.id ? (
              <Input
                className="flex-1 min-w-[220px]"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                autoFocus
              />
            ) : (
              <span className={`flex-1 min-w-[220px] font-medium text-sm ${!reason.isActive ? 'text-muted-foreground line-through' : ''}`}>
                {reason.name}
              </span>
            )}
            {reason.isSystem && <Badge variant="outline">افتراضي محمي</Badge>}
            <Badge variant={reason.isActive ? 'secondary' : 'outline'}>{reason.isActive ? 'نشط' : 'معطّل'}</Badge>
            {editId === reason.id ? (
              <>
                <Button size="sm" className="h-8 gap-1" onClick={() => editName.trim() && saveMutation.mutate({ id: reason.id, name: editName })} disabled={!editName.trim() || saveMutation.isPending}>
                  <Save className="w-3.5 h-3.5" />حفظ
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditId(null)}>إلغاء</Button>
              </>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title={reason.isSystem ? 'السبب الافتراضي محمي' : 'تعديل السبب'}
                  disabled={reason.isSystem}
                  onClick={() => { setEditId(reason.id); setEditName(reason.name); }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  disabled={reason.isSystem || toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(reason.id)}
                >
                  <Power className="w-3.5 h-3.5" />{reason.isActive ? 'تعطيل' : 'تفعيل'}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

interface ImportRow {
  [key: string]: string | number | undefined;
}

interface ImportResult {
  created: number;
  updated?: number;
  errors: { row: number; name: string; error: string }[];
}


interface Category {
  id: number;
  name: string;
  type: 'consumable' | 'equipment';
}


