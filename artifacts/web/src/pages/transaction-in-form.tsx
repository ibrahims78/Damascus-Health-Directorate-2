import { useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useListItems,
  useListEquipment,
  useCreateInTransaction,
  type Item,
  type Equipment,
} from '@workspace/api-client-react';
import { ArrowRight, Save, PackagePlus, CheckCircle2 } from 'lucide-react';
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
import { CatalogCombobox } from '@/components/catalog-combobox';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

const schema = z.object({
  itemType: z.enum(['item', 'equipment']),
  itemId: z.coerce.number().optional().nullable(),
  equipmentId: z.coerce.number().optional().nullable(),
  quantity: z.coerce.number().min(1, 'الكمية يجب أن تكون 1 على الأقل').optional().nullable(),
  deliveryNoteNumber: z.string().trim().min(1, 'رقم مذكرة التسليم مطلوب'),
  deliveryNoteDate: z.string().refine(isValidDate, 'تاريخ مذكرة التسليم غير صالح'),
  expiryDate: z
    .string()
    .optional()
    .refine((value) => !value || isValidDate(value), 'تاريخ الصلاحية غير صالح'),
  batchNumber: z.string().optional(),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function TransactionInForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [equipmentPickerOpen, setEquipmentPickerOpen] = useState(false);

  const { data: itemsData } = useListItems({ limit: 5000 });
  const { data: equipmentData } = useListEquipment({ limit: 5000 });
  const mutation = useCreateInTransaction();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      itemType: 'item',
      itemId: null,
      equipmentId: null,
      quantity: 1,
      deliveryNoteNumber: '',
      deliveryNoteDate: '',
      expiryDate: '',
      batchNumber: '',
      notes: '',
    },
  });

  const watchItemType = form.watch('itemType');
  const watchItemId = form.watch('itemId');
  const watchEquipmentId = form.watch('equipmentId');
  const watchQuantity = form.watch('quantity');

  const selectedItem =
    watchItemType === 'item' && watchItemId
      ? itemsData?.items.find((i: Item) => i.id === Number(watchItemId))
      : null;

  const selectedEquipment =
    watchItemType === 'equipment' && watchEquipmentId
      ? equipmentData?.equipment.find((e: Equipment) => e.id === Number(watchEquipmentId))
      : null;
  const equipmentHasSerialNumber = Boolean(selectedEquipment?.serialNumber?.trim());

  const handleSubmit = (data: FormValues) => {
    // Validate item/equipment selection
    if (data.itemType === 'item' && !data.itemId) {
      form.setError('itemId', { message: 'يرجى اختيار المادة' });
      return;
    }
    if (data.itemType === 'equipment' && !data.equipmentId) {
      form.setError('equipmentId', { message: 'يرجى اختيار التجهيز' });
      return;
    }
    if (!data.quantity || data.quantity < 1) {
      form.setError('quantity', { message: 'الكمية يجب أن تكون 1 على الأقل' });
      return;
    }
    if (data.itemType === 'equipment' && equipmentHasSerialNumber && data.quantity !== 1) {
      form.setError('quantity', { message: 'التجهيز ذو الرقم التسلسلي يجب أن تكون كميته 1 فقط' });
      return;
    }

    // First press: show confirmation
    if (!pendingConfirm) {
      setPendingConfirm(true);
      return;
    }

    // Second press: submit
    mutation.mutate(
      {
        data: {
          itemType: data.itemType as 'item' | 'equipment',
          itemId: data.itemType === 'item' ? (data.itemId ?? null) : null,
          equipmentId: data.itemType === 'equipment' ? (data.equipmentId ?? null) : null,
          quantity: data.itemType === 'item' ? (data.quantity ?? null) : null,
          deliveryNoteNumber: data.deliveryNoteNumber.trim(),
          deliveryNoteDate: data.deliveryNoteDate,
          supplySource: 'central_warehouses',
          expiryDate: data.expiryDate || null,
          batchNumber: data.batchNumber?.trim() || null,
          notes: data.notes || null,
        },
      },
      {
        onSuccess: (tx: { id: number }) => {
          toast({ description: '✅ تم تسجيل عملية الإدخال بنجاح' });
          setLocation(`/print/${tx.id}`);
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error || 'حدث خطأ أثناء الحفظ';
          toast({ variant: 'destructive', description: msg });
          setPendingConfirm(false);
        },
      },
    );
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation('/transactions')}
        >
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center shrink-0">
            <PackagePlus className="w-5 h-5 text-success" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">تسجيل إدخال مادة</h1>
            <p className="text-sm text-muted-foreground">إضافة كمية للمخزون</p>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg shadow-sm p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            {/* Item Type Toggle */}
            <FormField
              control={form.control}
              name="itemType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>نوع الصنف *</FormLabel>
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant={field.value === 'item' ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => {
                        field.onChange('item');
                        form.setValue('equipmentId', null);
                        form.clearErrors('equipmentId');
                        setPendingConfirm(false);
                      }}
                    >
                      مادة / مستهلك
                    </Button>
                    <Button
                      type="button"
                      variant={field.value === 'equipment' ? 'default' : 'outline'}
                      className="flex-1"
                      onClick={() => {
                        field.onChange('equipment');
                        form.setValue('itemId', null);
                        form.setValue('quantity', 1);
                        form.clearErrors('itemId');
                        setPendingConfirm(false);
                      }}
                    >
                      تجهيز / معدة
                    </Button>
                  </div>
                </FormItem>
              )}
            />

            {/* Item Select */}
            {watchItemType === 'item' && (
              <FormField
                control={form.control}
                name="itemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>المادة *</FormLabel>
                    <FormControl>
                      <CatalogCombobox
                        value={field.value ? field.value.toString() : ''}
                        open={itemPickerOpen}
                        onOpenChange={setItemPickerOpen}
                        onValueChange={(value) => {
                          field.onChange(Number(value));
                          setPendingConfirm(false);
                        }}
                        placeholder="اختر المادة من القائمة..."
                        searchPlaceholder="ابحث باسم المادة أو رمزها..."
                        emptyMessage="لا توجد مادة مطابقة"
                        loading={!itemsData}
                        options={(itemsData?.items ?? [])
                          .filter((item: Item) => item.isActive)
                          .map((item: Item) => ({
                            value: item.id.toString(),
                            searchValue: `${item.id} ${item.name} ${item.code ?? ''}`,
                            label: (
                              <>
                                {item.name}
                                {item.code ? ` (${item.code})` : ''} — رصيد: {item.currentStock}{' '}
                                {item.unit}
                              </>
                            ),
                          }))}
                      />
                    </FormControl>

                    {/* Current Stock Info */}
                    {selectedItem && (
                      <div className="mt-2 p-3 bg-muted/50 rounded-md flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="text-muted-foreground">الرصيد الحالي:</span>
                        <Badge
                          variant={
                            selectedItem.currentStock <= selectedItem.minStock
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {selectedItem.currentStock} {selectedItem.unit}
                        </Badge>
                        {selectedItem.currentStock <= selectedItem.minStock && (
                          <span className="text-destructive text-xs">
                            ⚠ أقل من الحد الأدنى ({selectedItem.minStock}{' '}
                            {selectedItem.unit})
                          </span>
                        )}
                        {selectedItem.categoryName && (
                          <span className="text-muted-foreground text-xs">
                            التصنيف: {selectedItem.categoryName}
                          </span>
                        )}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Equipment Select */}
            {watchItemType === 'equipment' && (
              <FormField
                control={form.control}
                name="equipmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>التجهيز *</FormLabel>
                    <FormControl>
                      <CatalogCombobox
                        value={field.value ? field.value.toString() : ''}
                        open={equipmentPickerOpen}
                        onOpenChange={setEquipmentPickerOpen}
                        onValueChange={(value) => {
                          field.onChange(Number(value));
                          setPendingConfirm(false);
                        }}
                        placeholder="اختر التجهيز من القائمة..."
                        searchPlaceholder="ابحث باسم التجهيز أو الرقم التسلسلي..."
                        emptyMessage="لا يوجد تجهيز مطابق"
                        loading={!equipmentData}
                        options={(equipmentData?.equipment ?? []).map((equipment: Equipment) => ({
                          value: equipment.id.toString(),
                          searchValue: `${equipment.id} ${equipment.name} ${equipment.serialNumber ?? ''} ${equipment.model ?? ''}`,
                          label: (
                            <span className="block min-w-0 space-y-1">
                              <span className="block truncate font-medium">{equipment.name}</span>
                              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="rounded bg-muted px-1.5 py-0.5">
                                  الكمية: {equipment.quantity}
                                </span>
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
                    </FormControl>

                    {selectedEquipment && (
                      <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm flex gap-4">
                        <span className="text-muted-foreground">الحالة:</span>
                        <span>{conditionLabel(selectedEquipment.condition)}</span>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Quantity */}
            {(watchItemType === 'item' || watchItemType === 'equipment') && (
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      الكمية *
                      {selectedItem && (
                        <span className="font-normal text-muted-foreground mr-2 text-xs">
                          ({selectedItem.unit})
                        </span>
                      )}
                      {watchItemType === 'equipment' && (
                        <span className="font-normal text-muted-foreground mr-2 text-xs">
                          (قطعة)
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={watchItemType === 'equipment' && equipmentHasSerialNumber ? 1 : undefined}
                        readOnly={watchItemType === 'equipment' && equipmentHasSerialNumber}
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          field.onChange(
                            e.target.value === '' ? null : e.target.valueAsNumber,
                          );
                          setPendingConfirm(false);
                        }}
                        className={`max-w-[180px] ${
                          watchItemType === 'equipment' && equipmentHasSerialNumber
                            ? 'bg-muted cursor-not-allowed'
                            : ''
                        }`}
                      />
                    </FormControl>
                    {watchItemType === 'equipment' && (
                      <p className="text-xs text-muted-foreground">
                        {equipmentHasSerialNumber
                          ? 'الرقم التسلسلي يعرّف وحدة واحدة — الكمية ثابتة عند 1'
                          : 'أدخل عدد القطع التي وصلت ضمن هذا التجهيز'}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Central supply source */}
            <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm">
              <p className="font-semibold text-primary">جهة التوريد</p>
              <p className="mt-1 text-muted-foreground">
                المستودعات المركزية (قيمة نظامية ثابتة لا يمكن تغييرها)
              </p>
            </div>

            {/* Delivery note */}
            <FormField
              control={form.control}
              name="deliveryNoteNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رقم مذكرة التسليم *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ''}
                      placeholder="مثال: مذكرة-2026-001"
                      onChange={(event) => {
                        field.onChange(event);
                        setPendingConfirm(false);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="deliveryNoteDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>تاريخ مذكرة التسليم *</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        setPendingConfirm(false);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      تاريخ الصلاحية <span className="font-normal text-muted-foreground">(اختياري)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value || ''}
                        onChange={(event) => {
                          field.onChange(event);
                          setPendingConfirm(false);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="batchNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      رقم الدفعة <span className="font-normal text-muted-foreground">(اختياري)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value || ''}
                        placeholder="عند توفره"
                        onChange={(event) => {
                          field.onChange(event);
                          setPendingConfirm(false);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات (اختياري)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      className="h-20 resize-none"
                      placeholder="أي ملاحظات إضافية..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Confirmation Banner */}
            {pendingConfirm && !mutation.isPending && (
              <div className="p-4 bg-success/10 border border-success/30 rounded-md text-sm flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-success mb-1">تأكيد العملية</p>
                  <p className="text-foreground/80">
                      سيتم تسجيل إدخال من المستودعات المركزية برقم مذكرة{' '}
                      <strong>{form.getValues('deliveryNoteNumber')}</strong> بتاريخ{' '}
                      <strong>{form.getValues('deliveryNoteDate')}</strong> للصنف{' '}
                    {watchItemType === 'item' ? (
                      <>
                        <strong>{selectedItem?.name}</strong> بكمية{' '}
                        <strong>
                          {watchQuantity} {selectedItem?.unit}
                        </strong>
                      </>
                    ) : (
                      <>
                        <strong>{selectedEquipment?.name}</strong> بكمية{' '}
                        <strong>{watchQuantity} قطعة</strong>
                      </>
                    )}
                      {form.getValues('expiryDate') ? (
                        <>
                          {' '}وبصلاحية <strong>{form.getValues('expiryDate')}</strong>
                        </>
                      ) : (
                        <> بدون تاريخ صلاحية</>
                      )}
                      {form.getValues('batchNumber') && (
                        <>، الدفعة <strong>{form.getValues('batchNumber')}</strong></>
                      )}
                    . اضغط "تأكيد وطباعة" للمتابعة.
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation('/transactions')}
                disabled={mutation.isPending}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="gap-2 bg-success hover:bg-success/90 text-white"
              >
                <Save className="w-4 h-4" />
                {mutation.isPending
                  ? 'جاري الحفظ...'
                  : pendingConfirm
                    ? 'تأكيد وطباعة السند'
                    : 'حفظ وطباعة السند'}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

function conditionLabel(condition: string) {
  const map: Record<string, string> = {
    good: 'جيدة ✓',
    maintenance: 'قيد الصيانة',
    broken: 'معطلة',
    consumed: 'مستهلكة',
    needs_inspection: 'تحتاج فحص',
  };
  return map[condition] ?? condition;
}
