import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useForm, useWatch } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useGetEquipment,
  useCreateEquipment,
  useUpdateEquipment,
} from '@workspace/api-client-react';
import { ArrowRight, Save, Lock, Wrench, Info, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';
import { maintenanceDateError, serialQuantityError } from '@/lib/equipment-validation';

/* ──────────────────────────── Schema ───────────────────────────────────── */

const CURRENT_YEAR = new Date().getFullYear();

const equipmentSchema = z
  .object({
    name:                 z.string().min(2, 'الاسم مطلوب (حرفان على الأقل)'),
    equipmentType:        z.string().optional().nullable(),
    model:                z.string().optional().nullable(),
    serialNumber:         z.string().optional().nullable(),
    condition:            z.string().default('good'),
    manufactureYear:      z.coerce
      .number()
      .int()
      .min(1900, 'السنة يجب أن تكون 1900 أو أحدث')
      .max(CURRENT_YEAR, `السنة يجب ألا تتجاوز ${CURRENT_YEAR}`)
      .optional()
      .nullable(),
    originCountry:        z.string().optional().nullable(),
    currentHolder:        z.string().optional().nullable(),
    notes:                z.string().optional().nullable(),
    quantity:             z.coerce.number().int().min(1, 'الكمية يجب أن تكون 1 على الأقل').default(1),
    minQuantity:          z.coerce.number().int().min(0, 'الحد الأدنى يجب أن يكون 0 أو أكثر').default(0),
    // Maintenance tracking
    maintenanceSentAt:    z.string().optional().nullable(),
    maintenanceReturnedAt: z.string().optional().nullable(),
    maintenanceNotes:     z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const serialError = serialQuantityError(data.serialNumber, data.quantity);
    if (serialError) ctx.addIssue({ code: 'custom', message: serialError, path: ['quantity'] });

    const maintenanceError = maintenanceDateError(data.maintenanceSentAt, data.maintenanceReturnedAt);
    if (maintenanceError) {
      ctx.addIssue({
        code: 'custom',
        message: maintenanceError,
        path: data.maintenanceReturnedAt && data.maintenanceReturnedAt < (data.maintenanceSentAt ?? '')
          ? ['maintenanceReturnedAt']
          : ['maintenanceSentAt'],
      });
    }
  });

type EquipmentFormValues = z.infer<typeof equipmentSchema>;

const DEFAULT_TECHNICAL_CONDITIONS = [
  { key: 'good', label: 'جيد' },
  { key: 'needs_inspection', label: 'يحتاج فحص' },
  { key: 'maintenance', label: 'تحت الصيانة' },
  { key: 'broken', label: 'معطل' },
  { key: 'consumed', label: 'مستهلك / متلف' },
];

/* ──────────────────────────── Loading skeleton ──────────────────────────── */

function FormSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-7 w-52" />
      </div>
      <div className="bg-card border rounded-lg shadow-sm p-6 space-y-6">
        <div className="grid grid-cols-2 gap-6 p-4 rounded-lg border bg-muted/30">
          <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
          <div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /></div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-24 w-full" /></div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────── Section divider ───────────────────────────── */

function SectionLabel({ icon: Icon, title, description }: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-2 pt-2">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

/* ──────────────────────────── Form component ────────────────────────────── */

export function EquipmentForm({ equipmentId }: { equipmentId?: number }) {
  const [, setLocation] = useLocation();

  const isEditing = !!equipmentId;

  const { data: settings } = useQuery<{ technicalConditions?: string | null }>({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings', { credentials: 'include' });
      if (!response.ok) throw new Error('فشل جلب الحالات الفنية');
      return response.json();
    },
  });

  let technicalConditions = DEFAULT_TECHNICAL_CONDITIONS;
  try {
    const parsed = settings?.technicalConditions ? JSON.parse(settings.technicalConditions) : null;
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (condition) =>
          condition &&
          typeof condition.key === 'string' &&
          typeof condition.label === 'string',
      )
    ) {
      technicalConditions = parsed;
    }
  } catch { /* use defaults */ }

  const { data: eq, isLoading } = useGetEquipment(
    equipmentId as number,
    { query: { enabled: isEditing, queryKey: ['equipment', equipmentId] } }
  );

  const createMutation = useCreateEquipment();
  const updateMutation = useUpdateEquipment();

  const form = useForm<EquipmentFormValues>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: {
      name:                  '',
      equipmentType:         '',
      model:                 '',
      serialNumber:          '',
      condition:             'good',
      manufactureYear:       undefined,
      originCountry:         '',
      currentHolder:         '',
      notes:                 '',
      quantity:              1,
      minQuantity:           0,
      maintenanceSentAt:     '',
      maintenanceReturnedAt: '',
      maintenanceNotes:      '',
    },
  });

  useEffect(() => {
    if (isEditing && eq) {
      form.reset({
        name:                  eq.name,
        equipmentType:         eq.equipmentType || '',
        model:                 eq.model || '',
        serialNumber:          eq.serialNumber || '',
        condition:             eq.condition,
        manufactureYear:       eq.manufactureYear || undefined,
        originCountry:         eq.originCountry || '',
        currentHolder:         eq.currentHolder || '',
        notes:                 eq.notes || '',
        quantity:              eq.quantity ?? 1,
        minQuantity:           eq.minQuantity ?? 0,
        maintenanceSentAt:     eq.maintenanceSentAt || '',
        maintenanceReturnedAt: eq.maintenanceReturnedAt || '',
        maintenanceNotes:      eq.maintenanceNotes || '',
      });
    }
  }, [eq, isEditing, form]);

  /* Auto-lock quantity to 1 when serial number is entered */
  const serialNumberValue = useWatch({ control: form.control, name: 'serialNumber' });
  const conditionValue    = useWatch({ control: form.control, name: 'condition' });
  const hasSerialNumber   = !!(serialNumberValue?.trim());
  const isInMaintenance   = conditionValue === 'maintenance';

  useEffect(() => {
    if (hasSerialNumber) {
      const current = form.getValues('quantity');
      if (current !== 1) form.setValue('quantity', 1, { shouldValidate: true });
    }
  }, [hasSerialNumber, form]);

  /* Extract server error message */
  const getServerErrorMessage = (err: unknown): string => {
    if (err && typeof err === 'object' && 'response' in err) {
      const res = (err as any).response;
      if (res?.data?.error)   return res.data.error;
      if (res?.data?.message) return res.data.message;
    }
    return '';
  };

  const applyServerError = (err: unknown) => {
    const message = getServerErrorMessage(err);
    if (message.includes('الرقم التسلسلي')) {
      form.setError('serialNumber', { type: 'server', message });
      return;
    }
    toast.error(message || 'حدث خطأ أثناء حفظ التجهيز');
  };

  const onSubmit = (data: EquipmentFormValues) => {
    const payload = {
      ...data,
      manufactureYear:       data.manufactureYear || null,
      maintenanceSentAt:     data.maintenanceSentAt || null,
      maintenanceReturnedAt: data.maintenanceReturnedAt || null,
      maintenanceNotes:      data.maintenanceNotes || null,
    };

    if (isEditing) {
      // Balance is managed exclusively through documented adjustment
      // movements (approved plan §3); never send quantity on edit.
      delete (payload as Record<string, unknown>).quantity;
      updateMutation.mutate(
        { id: equipmentId!, data: payload },
        {
          onSuccess: () => {
            toast.success('تم تعديل التجهيز بنجاح');
            setLocation('/equipment');
          },
          onError: (err) => {
            applyServerError(err);
          },
        }
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast.success('تم إضافة التجهيز بنجاح');
            setLocation('/equipment');
          },
          onError: (err) => {
            applyServerError(err);
          },
        }
      );
    }
  };

  if (isEditing && isLoading) return <FormSkeleton />;

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Page header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/equipment')} aria-label="العودة">
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEditing ? 'تعديل بيانات التجهيز' : 'إضافة تجهيز طبي جديد'}
          </h1>
          {isEditing && eq && (
            <p className="text-sm text-muted-foreground mt-0.5">
              آخر تحديث: {eq.updatedAt ? new Date(eq.updatedAt).toLocaleDateString('ar-SY') : '—'}
            </p>
          )}
        </div>
      </div>

      <div className="bg-card border rounded-lg shadow-sm p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

            {/* ── Quantity row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-6 p-4 rounded-lg border bg-muted/30">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      الكمية / العدد
                      {hasSerialNumber && (
                        <span className="flex items-center gap-1 text-xs font-normal text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800">
                          <Lock className="h-3 w-3" />
                          مقيّدة
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={field.value ?? 1}
                            readOnly
                            disabled
                            className="bg-muted cursor-not-allowed max-w-[140px]"
                            aria-label="الكمية الحالية (قراءة فقط)"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/30"
                            onClick={() => setLocation(`/equipment/${equipmentId}/adjust`)}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            تسوية جرد
                          </Button>
                        </div>
                      ) : (
                        <Input
                          type="number"
                          min={1}
                          max={hasSerialNumber ? 1 : undefined}
                          readOnly={hasSerialNumber}
                          className={hasSerialNumber ? 'bg-muted cursor-not-allowed' : ''}
                          {...field}
                        />
                      )}
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {isEditing
                        ? 'لا تُعدَّل الكمية من شاشة البيانات — تُغيَّر عبر «تسوية جرد» كسند حركة موثق'
                        : hasSerialNumber
                        ? 'الرقم التسلسلي يعرّف جهازاً واحداً — الكمية ثابتة عند 1'
                        : 'عدد القطع المتوفرة (للمستلزمات المجمّعة بدون رقم تسلسلي)'}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الحد الأدنى للتنبيه</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      يُطلق تنبيه نقص عند الوصول لهذا الحد (0 = بلا تنبيه)
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ── Basic info ───────────────────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel icon={Info} title="البيانات الأساسية" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الاسم التعريفي <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="مثال: جهاز صدمة كهربائية" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="equipmentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>النوع</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ''} placeholder="مثال: Defibrillator" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الموديل (Model)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ''} dir="ltr" className="text-right" placeholder="مثال: ZOLL AED 3" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="serialNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الرقم التسلسلي (S/N)</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2">
                          <Input
                            {...field}
                            value={field.value || ''}
                            dir="ltr"
                            className="text-right"
                            placeholder="اتركه فارغاً للمستلزمات المجمّعة"
                          />
                          <CopyButton value={field.value} label="الرقم التسلسلي" className="shrink-0" />
                        </div>
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        إدخاله يُقيّد الكمية تلقائياً عند 1
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الحالة الفنية <span className="text-destructive">*</span></FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {technicalConditions.map((condition) => (
                            <SelectItem key={condition.key} value={condition.key}>
                              {condition.label}
                            </SelectItem>
                          ))}
                          {field.value &&
                            !technicalConditions.some((condition) => condition.key === field.value) && (
                              <SelectItem value={field.value}>{field.value}</SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="manufactureYear"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>سنة الصنع</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1900}
                          max={CURRENT_YEAR}
                          placeholder={`مثال: ${CURRENT_YEAR - 3}`}
                          {...field}
                          value={field.value || ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="originCountry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>بلد المنشأ</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ''} placeholder="مثال: ألمانيا" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currentHolder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>العهدة الحالية (مع من؟)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ''}
                          placeholder="اسم أمين العهدة أو رقم الأصل"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* ── Maintenance tracking (shown only when condition = maintenance) ── */}
            {isInMaintenance && (
              <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-900/10">
                <SectionLabel
                  icon={Wrench}
                  title="تتبع الصيانة"
                  description="سجّل تواريخ الإرسال والإعادة وأي ملاحظات تخص عملية الصيانة"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="maintenanceSentAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ الإرسال للصيانة</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="maintenanceReturnedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ الإعادة من الصيانة</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="maintenanceNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ملاحظات الصيانة</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value || ''}
                          className="h-20"
                          placeholder="سبب الإرسال، الجهة المانحة للصيانة، تفاصيل العطل..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* ── Notes ─────────────────────────────────────────────────── */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات عامة</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      className="h-24"
                      placeholder="أي معلومات إضافية عن هذا التجهيز..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── Actions ───────────────────────────────────────────────── */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation('/equipment')}
                disabled={isPending}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={isPending} className="gap-2 min-w-[130px]">
                {isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    جاري الحفظ...
                  </span>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {isEditing ? 'حفظ التعديلات' : 'إضافة التجهيز'}
                  </>
                )}
              </Button>
            </div>

          </form>
        </Form>
      </div>
    </div>
  );
}
