import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useListItems, useListEquipment, type Item, type Equipment } from '@workspace/api-client-react';
import { ArrowRight, Save, SlidersHorizontal, AlertTriangle, Boxes, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CatalogCombobox } from '@/components/catalog-combobox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { isValidIsoDate } from '@/lib/inventory-validation';

const schema = z.object({
  entityType: z.enum(['item', 'equipment']),
  itemId: z.coerce.number().optional().nullable(),
  equipmentId: z.coerce.number().optional().nullable(),
  newStock: z.coerce.number({ required_error: 'الكمية الصحيحة مطلوبة' }).min(0, 'الكمية لا يمكن أن تكون سالبة'),
  documentDate: z.string()
    .min(1, 'تاريخ الجرد مطلوب')
    .refine(isValidIsoDate, 'تاريخ الجرد غير صالح'),
  reason: z.string().min(5, 'رقم المحضر مطلوب (5 أحرف على الأقل)'),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

type EquipmentHistorySummary = {
  minQuantity: number;
  custodyQuantity: number;
  availableQuantity: number;
};

const today = () => new Date().toISOString().slice(0, 10);

export function AdjustmentForm({
  preselectedItemId,
  preselectedEquipmentId,
}: {
  preselectedItemId?: number;
  preselectedEquipmentId?: number;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [equipmentPickerOpen, setEquipmentPickerOpen] = useState(false);
  const [entityType, setEntityType] = useState<'item' | 'equipment'>(
    preselectedEquipmentId ? 'equipment' : 'item',
  );

  const { data: itemsData } = useListItems({ limit: 5000 });
  const { data: equipmentData } = useListEquipment({ limit: 5000 });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      entityType: entityType,
      itemId: preselectedItemId ?? ('' as unknown as number),
      equipmentId: preselectedEquipmentId ?? ('' as unknown as number),
      newStock: '' as unknown as number,
      documentDate: today(),
      reason: '',
      notes: '',
    },
  });

  const watchEntityType = form.watch('entityType');
  const watchItemId = form.watch('itemId');
  const watchEquipmentId = form.watch('equipmentId');
  const watchNewStock = form.watch('newStock');

  // ── Selected entity (item or equipment) ────────────────────────────────────
  const selectedItem =
    watchEntityType === 'item' && watchItemId && itemsData?.items
      ? itemsData.items.find((i: Item) => i.id === Number(watchItemId))
      : null;

  const selectedEquipment =
    watchEntityType === 'equipment' && watchEquipmentId && equipmentData?.equipment
      ? equipmentData.equipment.find((e: Equipment) => e.id === Number(watchEquipmentId))
      : null;

  // ── Equipment custody/available summary (existing history endpoint) ────────
  const { data: equipmentSummary } = useQuery({
    queryKey: ['equipment-history-summary', watchEquipmentId],
    queryFn: async () => {
      const res = await fetch(`/api/equipment/${watchEquipmentId}/history?limit=1`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('تعذر تحميل بيانات التجهيز');
      const json = await res.json();
      const summary = json?.equipment as EquipmentHistorySummary | undefined;
      return summary ?? null;
    },
    enabled: watchEntityType === 'equipment' && !!watchEquipmentId,
  });

  // Reset the reference when switching entity type
  useEffect(() => {
    setConfirmed(false);
    if (entityType === 'item') {
      form.setValue('itemId', preselectedItemId ?? ('' as unknown as number));
      form.setValue('equipmentId', null);
    } else {
      form.setValue('equipmentId', preselectedEquipmentId ?? ('' as unknown as number));
      form.setValue('itemId', null);
    }
    form.setValue('newStock', '' as unknown as number);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  const currentStock =
    watchEntityType === 'item'
      ? selectedItem?.currentStock ?? null
      : selectedEquipment?.quantity ?? null;

  const delta =
    currentStock !== null && currentStock !== undefined && watchNewStock !== undefined && watchNewStock !== null && watchNewStock !== ('' as unknown as number)
      ? Number(watchNewStock) - currentStock
      : null;

  const custodyFloor =
    watchEntityType === 'equipment' ? (equipmentSummary?.custodyQuantity ?? 0) : 0;

  const belowCustodyFloor =
    watchEntityType === 'equipment' &&
    watchNewStock !== ('' as unknown as number) &&
    watchNewStock !== undefined &&
    watchNewStock !== null &&
    Number(watchNewStock) < custodyFloor;

  const adjustMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const res = await fetch('/api/transactions/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          itemType: data.entityType,
          itemId: data.entityType === 'item' ? data.itemId : undefined,
          equipmentId: data.entityType === 'equipment' ? data.equipmentId : undefined,
          newStock: data.newStock,
          documentDate: data.documentDate,
          reason: data.reason,
          notes: data.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'حدث خطأ أثناء الحفظ');
      }
      return res.json();
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['listItems'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['listEquipment'] });
      qc.invalidateQueries({ queryKey: ['equipment'] });
      qc.invalidateQueries({ queryKey: ['listTransactions'] });
      toast({ description: `✅ تمت تسوية الجرد بنجاح — السند ${result?.documentNumber ?? ''}` });
      setLocation(entityType === 'equipment' ? '/equipment' : '/items');
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', description: err.message });
      setConfirmed(false);
    },
  });

  const handleSubmit = (data: FormValues) => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    adjustMutation.mutate(data);
  };

  const entityName = selectedItem?.name ?? selectedEquipment?.name ?? null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/items')}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <SlidersHorizontal className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">تسوية جرد</h1>
            <p className="text-sm text-muted-foreground">
              تصحيح رصيد مادة أو تجهيز مع توثيق رقم المحضر كسند حركة قابل للطباعة
            </p>
          </div>
        </div>
      </div>

      {/* Type toggle */}
      {!preselectedEquipmentId && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setEntityType('item')}
            className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
              entityType === 'item'
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <Boxes className="h-4 w-4" />
            مادة (مستهلكات)
          </button>
          <button
            type="button"
            onClick={() => setEntityType('equipment')}
            className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors ${
              entityType === 'equipment'
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            <Cpu className="h-4 w-4" />
            تجهيز
          </button>
        </div>
      )}

      <div className="bg-card border rounded-lg shadow-sm p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <input type="hidden" {...form.register('entityType')} value={entityType} />

            {/* Entity Select */}
            {entityType === 'item' ? (
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
                          setConfirmed(false);
                          form.setValue('newStock', '' as unknown as number);
                        }}
                        placeholder="اختر المادة من القائمة..."
                        searchPlaceholder="ابحث باسم المادة أو رمزها..."
                        emptyMessage="لا توجد مادة مطابقة"
                        loading={!itemsData}
                        disabled={!!preselectedItemId}
                        options={(itemsData?.items ?? [])
                          .filter((item: Item) => item.isActive)
                          .map((item: Item) => ({
                            value: item.id.toString(),
                            searchValue: `${item.id} ${item.name} ${item.code ?? ''} ${item.batchNumber ?? ''}`,
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
                    {selectedItem && (
                      <div className="mt-2 p-3 bg-muted/50 rounded-md flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="text-muted-foreground">الرصيد الحالي في النظام:</span>
                        <Badge
                          variant={
                            selectedItem.currentStock <= selectedItem.minStock ? 'destructive' : 'secondary'
                          }
                        >
                          {selectedItem.currentStock} {selectedItem.unit}
                        </Badge>
                        {selectedItem.currentStock <= selectedItem.minStock && (
                          <span className="text-destructive text-xs">
                            ⚠ أقل من الحد الأدنى ({selectedItem.minStock} {selectedItem.unit})
                          </span>
                        )}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
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
                          setConfirmed(false);
                          form.setValue('newStock', '' as unknown as number);
                        }}
                        placeholder="اختر التجهيز من القائمة..."
                        searchPlaceholder="ابحث باسم التجهيز أو الموديل أو الرقم التسلسلي..."
                        emptyMessage="لا يوجد تجهيز مطابق"
                        loading={!equipmentData}
                        disabled={!!preselectedEquipmentId}
                        options={(equipmentData?.equipment ?? [])
                          .filter((e: Equipment) => !e.serialNumber)
                          .map((e: Equipment) => ({
                            value: e.id.toString(),
                            searchValue: `${e.id} ${e.name} ${e.model ?? ''} ${e.serialNumber ?? ''} ${e.equipmentType ?? ''}`,
                            label: (
                              <>
                                {e.name}
                                {e.model ? ` (${e.model})` : ''} — رصيد: {e.quantity ?? 0}
                              </>
                            ),
                          }))}
                      />
                    </FormControl>

                    {selectedEquipment && (
                      <div className="mt-2 p-3 bg-muted/50 rounded-md flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="text-muted-foreground">الرصيد الإجمالي:</span>
                        <Badge variant="secondary">{selectedEquipment.quantity ?? 0}</Badge>
                        <span className="text-muted-foreground">العهد المفتوحة:</span>
                        <Badge variant={custodyFloor > 0 ? 'destructive' : 'secondary'}>
                          {custodyFloor}
                        </Badge>
                        <span className="text-muted-foreground">المتاح في المستودع:</span>
                        <Badge variant="secondary">
                          {equipmentSummary?.availableQuantity ?? selectedEquipment.quantity ?? 0}
                        </Badge>
                        {selectedEquipment.minQuantity != null && selectedEquipment.minQuantity > 0 && (
                          <>
                            <span className="text-muted-foreground">حد التنبيه:</span>
                            <Badge variant="secondary">{selectedEquipment.minQuantity}</Badge>
                          </>
                        )}
                        {selectedEquipment.serialNumber && (
                          <span className="text-xs text-muted-foreground">
                            (مسلسَل — يُعالج عبر مسار الفقد/الشطب أو الحالة)
                          </span>
                        )}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* New Stock */}
            <FormField
              control={form.control}
              name="newStock"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    الكمية الصحيحة (الرصيد الفعلي) *
                    {selectedItem && (
                      <span className="font-normal text-muted-foreground mr-2 text-xs">
                        ({selectedItem.unit})
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        field.onChange(e.target.value === '' ? '' : e.target.valueAsNumber);
                        setConfirmed(false);
                      }}
                      className="max-w-[200px]"
                      placeholder="أدخل الكمية الفعلية..."
                    />
                  </FormControl>

                  {/* Custody floor warning */}
                  {belowCustodyFloor && (
                    <p className="text-destructive text-sm flex items-center gap-1.5 mt-1">
                      <AlertTriangle className="w-4 h-4" />
                      لا يمكن أن يقل الرصيد الجديد عن العهد المفتوحة ({custodyFloor})
                    </p>
                  )}

                  {/* Delta indicator */}
                  {currentStock !== null && delta !== null && !isNaN(delta) && (
                    <div className={`mt-1.5 flex items-center gap-2 text-sm font-medium ${
                      delta > 0
                        ? 'text-success'
                        : delta < 0
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }`}>
                      {delta > 0 ? (
                        <span>▲ زيادة {delta}{selectedItem ? ` ${selectedItem.unit}` : ''}</span>
                      ) : delta < 0 ? (
                        <span>▼ نقص {Math.abs(delta)}{selectedItem ? ` ${selectedItem.unit}` : ''}</span>
                      ) : (
                        <span>لا تغيير في الكمية</span>
                      )}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Document date */}
            <FormField
              control={form.control}
              name="documentDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>تاريخ الجرد / المستند *</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      onChange={(e) => { field.onChange(e); setConfirmed(false); }}
                      className="max-w-[200px]"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Reason */}
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رقم المحضر *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                       placeholder="مثال: محضر جرد رقم 123..."
                      onChange={(e) => { field.onChange(e); setConfirmed(false); }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات إضافية (اختياري)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      className="h-20 resize-none"
                      placeholder="أي تفاصيل إضافية..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Confirmation banner */}
            {confirmed && !adjustMutation.isPending && entityName && delta !== null && (
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md text-sm flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">تأكيد التسوية</p>
                  <p className="text-foreground/80">
                    سيتم تغيير رصيد <strong>{entityName}</strong> من{' '}
                    <strong>{currentStock}</strong> إلى{' '}
                    <strong>{Number(watchNewStock)}</strong>
                    {delta !== 0 && (
                      <span className={delta > 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>
                        {' '}({delta > 0 ? '+' : ''}{delta})
                      </span>
                    )}
                    {watchEntityType === 'equipment' && custodyFloor > 0 && (
                      <span className="text-muted-foreground">
                        {' '}— العهد المفتوحة {custodyFloor} محفوظة
                      </span>
                    )}
                    . سيُصدر سند «تسوية جرد» موثق في سجل العمليات، ولا يمكن التراجع عنه تلقائياً.
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(entityType === 'equipment' ? '/equipment' : '/items')}
                disabled={adjustMutation.isPending}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={adjustMutation.isPending}
                className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Save className="w-4 h-4" />
                {adjustMutation.isPending
                  ? 'جاري الحفظ...'
                  : confirmed
                  ? 'تأكيد التسوية'
                  : 'حفظ التسوية'}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
