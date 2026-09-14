import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  useCreateCentralReturnTransaction,
  useCreateCustodyOutTransaction,
  useCreateCustodyReturnTransaction,
  useCreateDamageTransaction,
  useListCustodies,
  useListEquipment,
  useListItems,
  useListRecipients,
  type Equipment,
  type Item,
} from '@workspace/api-client-react';
import {
  ArchiveRestore,
  ArrowRight,
  CheckCircle2,
  FileWarning,
  RotateCcw,
  Save,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CatalogCombobox } from '@/components/catalog-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';
import { isValidIsoDate, validateExceptionMovement } from '@/lib/inventory-validation';

const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_RETURN_CONDITIONS = [
  { key: 'good', label: 'جيد', behavior: 'good' },
  { key: 'damaged', label: 'تالف', behavior: 'damaged' },
  { key: 'needs_maintenance', label: 'يحتاج صيانة', behavior: 'needs_maintenance' },
  { key: 'missing', label: 'مفقود', behavior: 'missing' },
];

function useReturnConditions() {
  const { data } = useQuery<{ returnConditions?: string | null }>({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings', { credentials: 'include' });
      if (!response.ok) throw new Error('فشل جلب حالات الإعادة');
      return response.json();
    },
  });
  try {
    const parsed = data?.returnConditions ? JSON.parse(data.returnConditions) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RETURN_CONDITIONS;
  } catch {
    return DEFAULT_RETURN_CONDITIONS;
  }
}

function errorMessage(error: unknown) {
  const typedError = error as {
    data?: { error?: string; message?: string } | string | null;
    response?: { data?: { error?: string; message?: string } | string | null };
    message?: string;
  };
  const body = typedError.data ?? typedError.response?.data;
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object' && (body.error || body.message)) {
    return body.error || body.message || 'تعذر حفظ الحركة';
  }
  if (typedError.message && !typedError.message.startsWith('HTTP ')) return typedError.message;
  return 'تعذر حفظ الحركة، يرجى مراجعة البيانات والمحاولة مرة أخرى';
}

function PageFrame({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof UserRoundCheck;
  children: React.ReactNode;
}) {
  const [, setLocation] = useLocation();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/transactions')} aria-label="العودة">
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function FormCard({
  children,
  onSubmit,
  pending,
  confirming,
  onCancelConfirm,
  submitLabel,
}: {
  children: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  pending: boolean;
  confirming: boolean;
  onCancelConfirm: () => void;
  submitLabel: string;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-xl border bg-card p-6 shadow-sm">
      {children}
      {confirming && !pending && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">يرجى تأكيد الحركة</p>
            <p className="mt-1">سيتم إنشاء مستند مستقل وسجل تدقيق، ولا يمكن حذف الحركة بعد حفظها.</p>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-3 border-t pt-4">
        {confirming && !pending && (
          <Button type="button" variant="ghost" onClick={onCancelConfirm}>
            تعديل البيانات
          </Button>
        )}
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              جاري الحفظ...
            </>
          ) : (
            <>
              {confirming ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {confirming ? 'تأكيد وتسجيل الحركة' : submitLabel}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function EntityPicker({
  type,
  itemId,
  equipmentId,
  onTypeChange,
  onItemChange,
  onEquipmentChange,
}: {
  type: 'item' | 'equipment';
  itemId: number | null;
  equipmentId: number | null;
  onTypeChange: (type: 'item' | 'equipment') => void;
  onItemChange: (id: number | null) => void;
  onEquipmentChange: (id: number | null) => void;
}) {
  const { data: itemsData } = useListItems({ limit: 5000 });
  const { data: equipmentData } = useListEquipment({ limit: 5000 });
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [equipmentPickerOpen, setEquipmentPickerOpen] = useState(false);
  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex gap-2">
        <Button type="button" variant={type === 'item' ? 'default' : 'outline'} className="flex-1" onClick={() => onTypeChange('item')}>
          مادة / مستهلك
        </Button>
        <Button type="button" variant={type === 'equipment' ? 'default' : 'outline'} className="flex-1" onClick={() => onTypeChange('equipment')}>
          تجهيز / ثابت
        </Button>
      </div>
      {type === 'item' ? (
        <Field label="المادة" required>
          <CatalogCombobox
            value={itemId ? String(itemId) : ''}
            open={itemPickerOpen}
            onOpenChange={setItemPickerOpen}
            onValueChange={(value) => onItemChange(Number(value))}
            placeholder="اختر المادة..."
            searchPlaceholder="ابحث باسم المادة أو رمزها..."
            emptyMessage="لا توجد مادة مطابقة"
            loading={!itemsData}
            options={(itemsData?.items ?? [])
              .filter((item: Item) => item.isActive)
              .map((item: Item) => ({
                value: String(item.id),
                searchValue: `${item.id} ${item.name} ${item.code ?? ''} ${item.batchNumber ?? ''}`,
                label: `${item.name}${item.code ? ` (${item.code})` : ''} — المتاح ${item.currentStock} ${item.unit}`,
              }))}
          />
        </Field>
      ) : (
        <Field label="التجهيز" required>
          <CatalogCombobox
            value={equipmentId ? String(equipmentId) : ''}
            open={equipmentPickerOpen}
            onOpenChange={setEquipmentPickerOpen}
            onValueChange={(value) => onEquipmentChange(Number(value))}
            placeholder="اختر التجهيز..."
            searchPlaceholder="ابحث باسم التجهيز أو الرقم التسلسلي..."
            emptyMessage="لا يوجد تجهيز مطابق"
            loading={!equipmentData}
            options={(equipmentData?.equipment ?? []).map((equipment: Equipment) => ({
              value: String(equipment.id),
              searchValue: `${equipment.id} ${equipment.name} ${equipment.serialNumber ?? ''} ${equipment.model ?? ''}`,
                label: (
                  <span className="block min-w-0 space-y-1">
                    <span className="block truncate font-medium">{equipment.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5">الكمية: {equipment.quantity}</span>
                      {equipment.serialNumber && (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          الرقم التسلسلي: {equipment.serialNumber}
                        </span>
                      )}
                      {equipment.model && <span>{equipment.model}</span>}
                    </span>
                  </span>
                ),
            }))}
          />
        </Field>
      )}
    </div>
  );
}

export function CustodyOutForm() {
  const [, setLocation] = useLocation();
  const { data: recipients } = useListRecipients();
  const { data: equipmentData } = useListEquipment({ limit: 5000 });
  const { data: custodies } = useListCustodies();
  const mutation = useCreateCustodyOutTransaction();
  const [equipmentId, setEquipmentId] = useState<number | null>(null);
  const [recipientId, setRecipientId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [holderName, setHolderName] = useState('');
  const [noteNumber, setNoteNumber] = useState('');
  const [date, setDate] = useState(today());
  const [location, setLocationValue] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const selectedEquipment = equipmentData?.equipment.find((equipment) => equipment.id === equipmentId);
  const openCustodyQuantity = selectedEquipment
    ? (custodies ?? [])
        .filter((custody) => custody.equipmentId === selectedEquipment.id && custody.outstandingQuantity > 0)
        .reduce((total, custody) => total + custody.outstandingQuantity, 0)
    : 0;
  const equipmentAvailable = selectedEquipment
    ? Math.max(0, (selectedEquipment.quantity ?? 0) - openCustodyQuantity)
    : null;
  const serialEquipment = Boolean(selectedEquipment?.serialNumber?.trim());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!equipmentId || !holderName.trim() || !noteNumber.trim() || !location.trim()) {
      toast.error('يرجى تعبئة التجهيز والمستلم ورقم المذكرة والمكان');
      return;
    }
    if (!isValidIsoDate(date)) {
      toast.error('يرجى اختيار تاريخ تسليم صالح');
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || (equipmentAvailable !== null && quantity > equipmentAvailable)) {
      toast.error(
        equipmentAvailable === 0
          ? 'لا توجد كمية متاحة لهذا التجهيز للعهدة'
          : `كمية العهدة يجب أن تكون بين 1 و ${equipmentAvailable}`,
      );
      return;
    }
    if (serialEquipment && quantity !== 1) {
      toast.error('التجهيز ذو الرقم التسلسلي يمثل وحدة واحدة فقط');
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    mutation.mutate(
      { data: { itemType: 'equipment', equipmentId, quantity, recipientId, holderName: holderName.trim(), custodyNoteNumber: noteNumber.trim(), custodyDate: date, custodyLocation: location.trim(), notes: notes.trim() || null } },
      {
        onSuccess: (transaction) => { toast.success('تم تسجيل تسليم العهدة بنجاح'); setLocation(`/print/${transaction.id}`); },
        onError: (error) => { toast.error(errorMessage(error)); setConfirming(false); },
      },
    );
  };

  return (
    <PageFrame title="تسليم عهدة شخصية" description="تخصيص تجهيز لمستلم دون اعتباره مادة مستهلكة" icon={UserRoundCheck}>
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
        <p className="font-semibold text-primary">قاعدة الرصيد</p>
        <p className="mt-1 text-muted-foreground">التسليم يزيد العهدة المفتوحة فقط، ولا يخفض إجمالي رصيد التجهيز التشغيلي.</p>
      </div>
      <FormCard onSubmit={submit} pending={mutation.isPending} confirming={confirming} onCancelConfirm={() => setConfirming(false)} submitLabel="تسجيل تسليم العهدة">
        <Field label="التجهيز" required>
          <EquipmentOnlyPicker equipmentId={equipmentId} onChange={setEquipmentId} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المستلم" required><Input value={holderName} onChange={(e) => { setHolderName(e.target.value); setConfirming(false); }} placeholder="اسم الموظف أو المسؤول" /></Field>
          <Field label="الجهة / المستلم المسجل">
            <CatalogCombobox
              value={recipientId ? String(recipientId) : ''}
              open={recipientPickerOpen}
              onOpenChange={setRecipientPickerOpen}
              onValueChange={(value) => { setRecipientId(Number(value)); setConfirming(false); }}
              placeholder="اختياري — اختر من القائمة"
              searchPlaceholder="ابحث باسم الجهة أو المستلم..."
              emptyMessage="لا توجد جهة مستلمة مطابقة"
              loading={!recipients}
              options={(recipients ?? []).map((recipient) => ({
                value: String(recipient.id),
                searchValue: `${recipient.id} ${recipient.name}`,
                label: recipient.name,
              }))}
            />
          </Field>
          <Field label="رقم مذكرة تسليم العهدة" required><Input value={noteNumber} onChange={(e) => { setNoteNumber(e.target.value); setConfirming(false); }} /></Field>
          <Field label="تاريخ التسليم" required><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirming(false); }} /></Field>
           <Field
             label="الكمية"
             required
             hint={
               serialEquipment
                 ? 'الرقم التسلسلي يعرّف وحدة واحدة — الكمية ثابتة عند 1'
                 : equipmentAvailable !== null
                   ? `المتاح للعهدة: ${equipmentAvailable}`
                   : 'اختر التجهيز لمعرفة الكمية المتاحة'
             }
           >
             <Input
               type="number"
               min={1}
               max={serialEquipment ? 1 : equipmentAvailable ?? undefined}
               value={quantity}
               readOnly={serialEquipment}
               disabled={equipmentAvailable === 0}
               onChange={(e) => {
                 setQuantity(e.target.valueAsNumber || 1);
                 setConfirming(false);
               }}
               className={serialEquipment || equipmentAvailable === 0 ? 'cursor-not-allowed bg-muted' : ''}
             />
           </Field>
           <Field label="مكان العهدة" required><Input value={location} onChange={(e) => { setLocationValue(e.target.value); setConfirming(false); }} placeholder="مثال: قسم التجهيزات - مستودع المزة" /></Field>
        </div>
        <Field label="ملاحظات"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-24" /></Field>
         {selectedEquipment && (
           <div role="status" aria-live="polite" className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm sm:grid-cols-3">
             <div><span className="text-muted-foreground">التجهيز</span><p className="font-semibold">{selectedEquipment.name}</p></div>
             <div><span className="text-muted-foreground">المتاح قبل التسليم</span><p className="font-semibold">{equipmentAvailable ?? 0}</p></div>
             <div><span className="text-muted-foreground">المتاح بعد التسليم</span><p className="font-semibold">{Math.max(0, (equipmentAvailable ?? 0) - quantity)}</p></div>
           </div>
         )}
      </FormCard>
    </PageFrame>
  );
}

function EquipmentOnlyPicker({ equipmentId, onChange }: { equipmentId: number | null; onChange: (id: number | null) => void }) {
  const { data } = useListEquipment({ limit: 5000 });
  const [open, setOpen] = useState(false);
  return (
    <CatalogCombobox
      value={equipmentId ? String(equipmentId) : ''}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(value) => onChange(Number(value))}
      placeholder="اختر التجهيز..."
      searchPlaceholder="ابحث باسم التجهيز أو الرقم التسلسلي..."
      emptyMessage="لا يوجد تجهيز مطابق"
      loading={!data}
      options={(data?.equipment ?? []).map((equipment: Equipment) => ({
        value: String(equipment.id),
        searchValue: `${equipment.id} ${equipment.name} ${equipment.serialNumber ?? ''} ${equipment.model ?? ''}`,
        label: (
          <span className="block min-w-0 space-y-1">
            <span className="block truncate font-medium">{equipment.name}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">الكمية: {equipment.quantity}</span>
              {equipment.serialNumber && (
                <span className="rounded bg-muted px-1.5 py-0.5">
                  الرقم التسلسلي: {equipment.serialNumber}
                </span>
              )}
              {equipment.model && <span>{equipment.model}</span>}
            </span>
          </span>
        ),
      }))}
    />
  );
}

export function CustodyReturnForm() {
  const [, setLocation] = useLocation();
  const { data: custodies, isLoading } = useListCustodies();
  const mutation = useCreateCustodyReturnTransaction();
  const returnConditions = useReturnConditions();
  const openCustodies = useMemo(() => (custodies ?? []).filter((custody) => custody.outstandingQuantity > 0), [custodies]);
  const [custodyId, setCustodyId] = useState<number | null>(() => {
    const value = new URLSearchParams(window.location.search).get('custodyId');
    const parsed = value ? Number(value) : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState('good');
  const [date, setDate] = useState(today());
  const [returnedToLocation, setReturnedToLocation] = useState('');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [validationError, setValidationError] = useState('');
  const selected = openCustodies.find((custody) => custody.id === custodyId);
  const [custodyPickerOpen, setCustodyPickerOpen] = useState(false);

  useEffect(() => {
    if (custodyId && !selected && !isLoading) {
      setCustodyId(null);
      setValidationError('العهدة المطلوبة غير موجودة أو تمت إعادتها بالكامل.');
    }
  }, [custodyId, selected, isLoading]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !returnedToLocation.trim() || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > selected.outstandingQuantity) {
      const message = selected
        ? !returnedToLocation.trim()
          ? 'أدخل المكان الذي عادت إليه العهدة'
          : `كمية الإعادة يجب ألا تتجاوز ${selected.outstandingQuantity}`
        : 'اختر عهدة مفتوحة ومكان الإعادة';
      setValidationError(message);
      toast.error(message);
      return;
    }
    if (!isValidIsoDate(date)) {
      setValidationError('تاريخ الإعادة غير صالح');
      toast.error('تاريخ الإعادة غير صالح');
      return;
    }
    setValidationError('');
    if (!confirming) { setConfirming(true); return; }
    mutation.mutate(
      { data: { custodyId: selected.id, quantity, returnCondition: condition as 'good' | 'damaged' | 'needs_maintenance' | 'missing', returnedToLocation: returnedToLocation.trim(), documentDate: date, inspectionNotes: inspectionNotes.trim() || null } },
      {
        onSuccess: (transaction) => { toast.success('تم تسجيل إعادة العهدة'); setLocation(`/print/${transaction.id}`); },
        onError: (error) => { toast.error(errorMessage(error)); setConfirming(false); },
      },
    );
  };

  return (
    <PageFrame title="إعادة عهدة شخصية" description="إعادة كل العهدة أو جزء منها مع توثيق حالتها" icon={RotateCcw}>
      <FormCard onSubmit={submit} pending={mutation.isPending} confirming={confirming} onCancelConfirm={() => setConfirming(false)} submitLabel="تسجيل إعادة العهدة">
        <Field label="العهدة المفتوحة" required hint={isLoading ? 'جاري تحميل العهد...' : 'تظهر العهد التي ما زال لها رصيد غير معاد فقط'}>
           <CatalogCombobox
            value={custodyId ? String(custodyId) : ''}
            open={custodyPickerOpen}
            onOpenChange={setCustodyPickerOpen}
             onValueChange={(value) => { setCustodyId(Number(value)); setQuantity(1); setConfirming(false); setValidationError(''); }}
            placeholder="اختر العهدة..."
            searchPlaceholder="ابحث باسم التجهيز أو اسم المستلم..."
            emptyMessage="لا توجد عهدة مفتوحة"
            loading={isLoading}
            options={openCustodies.map((custody) => ({
              value: String(custody.id),
              searchValue: `${custody.id} ${custody.equipmentName} ${custody.holderName} ${custody.deliveryNoteNumber}`,
              label: `${custody.equipmentName} — ${custody.holderName} — المتبقي ${custody.outstandingQuantity}`,
            }))}
          />
        </Field>
         {validationError && (
           <div role="alert" aria-live="polite" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
             {validationError}
           </div>
         )}
         {!isLoading && openCustodies.length === 0 && (
           <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
             لا توجد عهدة مفتوحة قابلة للإعادة حاليًا. يجب تسجيل تسليم عهدة أولًا أو تحديث الصفحة بعد تسجيل التسليم.
           </div>
         )}
         {selected && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm"><Badge variant="outline">السند: {selected.deliveryNoteNumber}</Badge><CopyButton value={selected.deliveryNoteNumber} label="رقم مذكرة العهدة" /><Badge variant="outline">المكان: {selected.location}</Badge><Badge variant="secondary">المتبقي: {selected.outstandingQuantity}</Badge></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الكمية المعادة" required><Input type="number" min={1} max={selected?.outstandingQuantity ?? 1} value={quantity} onChange={(e) => { setQuantity(e.target.valueAsNumber || 1); setConfirming(false); }} /></Field>
          <Field label="حالة الصنف عند الإعادة" required>
            <Select value={condition} onValueChange={(value) => { setCondition(value); setConfirming(false); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{returnConditions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select>
          </Field>
           <Field label="تاريخ الإعادة" required><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirming(false); }} /></Field>
           <Field label="المكان الذي عاد إليه" required><Input value={returnedToLocation} onChange={(e) => { setReturnedToLocation(e.target.value); setConfirming(false); setValidationError(''); }} placeholder="المستودع أو موقع الفحص" /></Field>
        </div>
        <Field label="ملاحظات الفحص"><Textarea value={inspectionNotes} onChange={(e) => setInspectionNotes(e.target.value)} className="min-h-24" /></Field>
      </FormCard>
    </PageFrame>
  );
}

function MovementEntityForm({
  title,
  description,
  icon,
  kind,
}: {
  title: string;
  description: string;
  icon: typeof FileWarning;
  kind: 'damage' | 'central-return';
}) {
  const [, setLocation] = useLocation();
  const damageMutation = useCreateDamageTransaction();
  const returnMutation = useCreateCentralReturnTransaction();
  const returnConditions = useReturnConditions();
  const [type, setType] = useState<'item' | 'equipment'>('equipment');
  const [itemId, setItemId] = useState<number | null>(null);
  const [equipmentId, setEquipmentId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState('damaged');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [validationError, setValidationError] = useState('');
  const pending = damageMutation.isPending || returnMutation.isPending;
  const { data: itemsData } = useListItems({ limit: 5000 });
  const { data: equipmentData } = useListEquipment({ limit: 5000 });
  const { data: custodies } = useListCustodies();
  const selectedItem = type === 'item' ? itemsData?.items.find((item) => item.id === itemId) : undefined;
  const selectedEquipment = type === 'equipment' ? equipmentData?.equipment.find((equipment) => equipment.id === equipmentId) : undefined;
  const openCustodyQuantity = selectedEquipment
    ? (custodies ?? [])
        .filter((custody) => custody.equipmentId === selectedEquipment.id && custody.outstandingQuantity > 0)
        .reduce((total, custody) => total + custody.outstandingQuantity, 0)
    : 0;
  const available = selectedItem
    ? selectedItem.currentStock
    : selectedEquipment
      ? Math.max(0, (selectedEquipment.quantity ?? 0) - openCustodyQuantity)
      : null;
  const selectedName = selectedItem?.name ?? selectedEquipment?.name;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const selectedId = type === 'item' ? itemId : equipmentId;
    const movementValidation = validateExceptionMovement({
      quantity,
      date,
      reason,
      available,
      serialised: Boolean(selectedEquipment?.serialNumber),
    });
    if (!selectedId || movementValidation) {
      const message = !selectedId
        ? 'يرجى اختيار مادة أو تجهيز أولاً'
        : movementValidation ?? 'يرجى مراجعة البيانات';
      setValidationError(message);
      toast.error(message);
      return;
    }
    setValidationError('');
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const callbacks = {
      onSuccess: (transaction: { id: number }) => { toast.success(kind === 'damage' ? 'تم تسجيل التلف' : 'تم تسجيل المرتجع المركزي'); setLocation(`/print/${transaction.id}`); },
      onError: (error: unknown) => { toast.error(errorMessage(error)); setConfirming(false); },
    };
    if (kind === 'damage') {
      damageMutation.mutate({ data: { itemType: type, itemId: type === 'item' ? itemId : null, equipmentId: type === 'equipment' ? equipmentId : null, quantity, reason: reason.trim(), damageDate: date, notes: notes.trim() || null } }, callbacks);
    } else {
      returnMutation.mutate({ data: { itemType: type, itemId: type === 'item' ? itemId : null, equipmentId: type === 'equipment' ? equipmentId : null, quantity, returnCondition: condition as 'good' | 'damaged' | 'needs_maintenance' | 'missing', reason: reason.trim(), documentDate: date, notes: notes.trim() || null } }, callbacks);
    }
  };

  return (
    <PageFrame title={title} description={description} icon={icon}>
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm">
        <p className="font-semibold text-destructive">{kind === 'damage' ? 'حركة تلف موثقة' : 'حركة مرتجع مستقلة'}</p>
        <p className="mt-1 text-muted-foreground">{kind === 'damage' ? 'لا تعدل الرصيد مباشرة؛ ينشئ النظام حركة تلف وسجل تدقيق ويستهلك الكمية المناسبة.' : 'المرتجع المركزي ليس إعادة عهدة، ويُسجل بمستند مستقل إلى المستودعات المركزية.'}</p>
      </div>
      {validationError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
        >
          {validationError}
        </div>
      )}
      <FormCard onSubmit={submit} pending={pending} confirming={confirming} onCancelConfirm={() => setConfirming(false)} submitLabel={kind === 'damage' ? 'مراجعة وتسجيل التلف' : 'مراجعة وتسجيل المرتجع'}>
        <EntityPicker type={type} itemId={itemId} equipmentId={equipmentId} onTypeChange={(value) => { setType(value); setItemId(null); setEquipmentId(null); setConfirming(false); setValidationError(''); }} onItemChange={(id) => { setItemId(id); setConfirming(false); setValidationError(''); }} onEquipmentChange={(id) => { setEquipmentId(id); setConfirming(false); setValidationError(''); }} />
         {selectedName && (
           <div role="status" aria-live="polite" className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm sm:grid-cols-3">
             <div><span className="text-muted-foreground">العنصر</span><p className="font-semibold">{selectedName}</p></div>
             <div><span className="text-muted-foreground">الرصيد المتاح قبل العملية</span><p className="font-semibold">{available ?? 0}</p></div>
             <div><span className="text-muted-foreground">الرصيد المتوقع بعد العملية</span><p className="font-semibold">{Math.max(0, (available ?? 0) - quantity)}</p></div>
             {selectedEquipment && openCustodyQuantity > 0 && (
               <div className="text-xs text-muted-foreground sm:col-span-3">العهد المفتوحة المحمية: {openCustodyQuantity}</div>
             )}
           </div>
         )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الكمية" required><Input type="number" min={1} value={quantity} onChange={(e) => { setQuantity(e.target.valueAsNumber || 1); setConfirming(false); setValidationError(''); }} /></Field>
          <Field label={kind === 'damage' ? 'تاريخ التلف' : 'تاريخ المرتجع'} required><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirming(false); setValidationError(''); }} /></Field>
          {kind === 'central-return' && (
            <Field label="حالة المرتجع" required><Select value={condition} onValueChange={(value) => { setCondition(value); setConfirming(false); setValidationError(''); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{returnConditions.map((item) => <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
          )}
           <Field label="رقم المحضر" required><Input value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); setValidationError(''); }} placeholder="أدخل رقم المحضر" /></Field>
        </div>
           <Field label="ملاحظات"><Textarea value={notes} onChange={(e) => { setNotes(e.target.value); setConfirming(false); setValidationError(''); }} className="min-h-24" /></Field>
      </FormCard>
    </PageFrame>
  );
}

export function DamageForm() {
  return <MovementEntityForm title="تسجيل تلف" description="إثبات تلف مادة أو تجهيز مع أثر واضح على الرصيد" icon={FileWarning} kind="damage" />;
}

export function CentralReturnForm() {
  return <MovementEntityForm title="مرتجع إلى المستودع المركزي" description="تسجيل خروج مستقل للصنف المرتجع إلى المستودعات المركزية" icon={ArchiveRestore} kind="central-return" />;
}