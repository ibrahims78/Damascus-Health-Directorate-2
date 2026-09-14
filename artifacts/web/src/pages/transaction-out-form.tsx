import { useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useListItems,
  useListRecipients,
  useListExitReasons,
  useGetItemFefoPreview,
  useCreateOutTransaction,
  type Item,
  type Recipient,
  type ExitReason,
} from '@workspace/api-client-react';
import {
  ArrowRight,
  Save,
  PackageMinus,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

const schema = z.object({
  itemType: z.literal('item'),
  itemId: z.coerce.number().optional().nullable(),
  quantity: z.coerce.number().min(1, 'الكمية يجب أن تكون 1 على الأقل'),
  recipientId: z.coerce.number().min(1, 'الجهة المستلمة مطلوبة'),
  exitReasonId: z.coerce.number().min(1, 'سبب الإخراج مطلوب'),
  internalDeliveryNoteNumber: z.string().trim().min(1, 'رقم مذكرة التسليم الداخلية مطلوب'),
  internalDeliveryNoteDate: z.string().refine(isValidDate, 'تاريخ مذكرة التسليم الداخلية غير صالح'),
  deliveryDestination: z.enum(['administrative_building', 'health_facility']),
  notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function TransactionOutForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);

  const { data: itemsData } = useListItems({ limit: 5000 });
  const { data: recipients } = useListRecipients();
  const { data: exitReasons } = useListExitReasons();
  const mutation = useCreateOutTransaction();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      itemType: 'item',
      itemId: null,
      quantity: 1,
      recipientId: 0,
      exitReasonId: 0,
      internalDeliveryNoteNumber: '',
      internalDeliveryNoteDate: '',
      deliveryDestination: 'health_facility',
      notes: '',
    },
  });

  const watchItemId = form.watch('itemId');
  const watchQuantity = form.watch('quantity') ?? 0;

  const selectedItem =
    watchItemId
      ? itemsData?.items.find((i: Item) => i.id === Number(watchItemId))
      : null;

  const fefoParams =
    watchItemId && watchQuantity > 0
      ? { itemId: Number(watchItemId), quantity: Number(watchQuantity) }
      : { itemId: 0, quantity: 1 };
  const { data: fefoPreview, isFetching: isFefoPreviewFetching } =
    useGetItemFefoPreview(fefoParams, {
      query: {
        queryKey: ['/api/items/fefo-preview', fefoParams],
        enabled: Boolean(watchItemId && watchQuantity > 0),
      },
    });

  const quantityExceedsStock =
    selectedItem != null && watchQuantity > 0
      ? watchQuantity > selectedItem.currentStock
      : false;
  const batchStockInsufficient =
    selectedItem != null &&
    watchQuantity > 0 &&
    fefoPreview != null &&
    !fefoPreview.canFulfill;

  const wouldBeBelowMin =
    selectedItem != null && watchQuantity > 0 && !quantityExceedsStock
      ? selectedItem.currentStock - watchQuantity < selectedItem.minStock
      : false;

  const handleSubmit = (data: FormValues) => {
    // Validate item/equipment selection
    if (!data.itemId) {
      form.setError('itemId', { message: 'يرجى اختيار المادة' });
      return;
    }
    if (!data.quantity || data.quantity < 1) {
      form.setError('quantity', { message: 'الكمية يجب أن تكون 1 على الأقل' });
      return;
    }

    // Hard block: quantity exceeds stock
    if (quantityExceedsStock || batchStockInsufficient) {
      toast({
        variant: 'destructive',
        description: batchStockInsufficient
          ? `الكمية المطلوبة (${data.quantity}) تتجاوز رصيد الدفعات الصالحة (${fefoPreview?.availableQuantity ?? 0} ${selectedItem?.unit})`
          : `الكمية المطلوبة (${data.quantity}) تتجاوز الرصيد المتاح (${selectedItem?.currentStock} ${selectedItem?.unit})`,
      });
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
          itemType: 'item',
          itemId: data.itemId ?? null,
          equipmentId: null,
          quantity: data.quantity,
          recipientId: data.recipientId,
          exitReasonId: data.exitReasonId,
          internalDeliveryNoteNumber: data.internalDeliveryNoteNumber.trim(),
          internalDeliveryNoteDate: data.internalDeliveryNoteDate,
          deliveryDestination: data.deliveryDestination,
          notes: data.notes || null,
        },
      },
      {
        onSuccess: (tx: { id: number }) => {
          toast({ description: '✅ تم تسجيل عملية الإخراج بنجاح' });
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
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
            <PackageMinus className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">تسجيل إخراج مادة</h1>
            <p className="text-sm text-muted-foreground">صرف كمية من المخزون</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-1 shadow-sm">
        <div className="grid grid-cols-2 gap-1" role="tablist" aria-label="نوع الإخراج">
          <Button
            type="button"
            role="tab"
            aria-selected="true"
            className="gap-2"
            variant="default"
          >
            <PackageMinus className="h-4 w-4" />
            إخراج مادة
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected="false"
            variant="ghost"
            className="gap-2"
            onClick={() => setLocation('/custody/out/new')}
          >
            <PackageMinus className="h-4 w-4" />
            إخراج تجهيز
          </Button>
        </div>
        <p className="px-3 pb-2 pt-2 text-xs text-muted-foreground">
          إخراج التجهيزات يتم كتسليم عهدة موثق حتى تبقى دورة حياة التجهيز قابلة للتتبع والإعادة.
        </p>
      </div>

      <div className="bg-card border rounded-lg shadow-sm p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm">
              <p className="font-semibold text-primary">إخراج مواد مستهلكة</p>
              <p className="mt-1 text-muted-foreground">
                هذه الشاشة تخص المواد المستهلكة فقط. يتم اختيار الدفعات تلقائيًا
                حسب أقرب تاريخ صلاحية (FEFO)، ولا تتضمن عهدة شخصية.
              </p>
            </div>

            {/* Item Select */}
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
                      <span className="text-muted-foreground">الرصيد الصالح للصرف:</span>
                      <Badge variant={batchStockInsufficient ? 'destructive' : 'outline'}>
                        {fefoPreview?.availableQuantity ?? '—'} {selectedItem.unit}
                      </Badge>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quantity (items only) */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    الكمية *
                    {selectedItem && (
                      <span className="font-normal text-muted-foreground mr-2 text-xs">
                        (الحد الأقصى: {selectedItem.currentStock} {selectedItem.unit})
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={selectedItem?.currentStock}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        field.onChange(
                          e.target.value === '' ? null : e.target.valueAsNumber,
                        );
                        setPendingConfirm(false);
                      }}
                      className={`max-w-[180px] ${quantityExceedsStock || batchStockInsufficient ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                    />
                  </FormControl>

                  {quantityExceedsStock && (
                    <div className="flex items-center gap-2 text-destructive text-sm mt-1 p-2 bg-destructive/10 rounded">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>
                        الكمية تتجاوز الرصيد المتاح ({selectedItem?.currentStock}{' '}
                        {selectedItem?.unit})
                      </span>
                    </div>
                  )}
                  {batchStockInsufficient && (
                    <div className="flex items-center gap-2 text-destructive text-sm mt-1 p-2 bg-destructive/10 rounded">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>
                        الدفعات الصالحة لا تكفي؛ المتاح للصرف{' '}
                        {fefoPreview?.availableQuantity} {selectedItem?.unit}
                      </span>
                    </div>
                  )}
                  {wouldBeBelowMin && (
                    <div className="flex items-center gap-2 text-warning text-sm mt-1 p-2 bg-warning/10 rounded">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        تحذير: الرصيد بعد الإخراج ({selectedItem!.currentStock - watchQuantity}{' '}
                        {selectedItem?.unit}) سيكون أقل من الحد الأدنى (
                        {selectedItem?.minStock} {selectedItem?.unit})
                      </span>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* FEFO Preview */}
            {selectedItem && (
              <div className="rounded-md border border-secondary bg-secondary/10 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">تخصيص الدفعات المتوقع (FEFO)</p>
                  {isFefoPreviewFetching && (
                    <span className="text-xs text-muted-foreground">جاري الحساب...</span>
                  )}
                </div>
                {!isFefoPreviewFetching && fefoPreview?.canFulfill && fefoPreview.allocations.length > 0 && (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {fefoPreview.allocations.map((allocation) => (
                      <div key={allocation.batchId} className="flex items-center justify-between gap-3">
                        <span>
                          دفعة {allocation.batchNumber || 'بلا رقم'}
                          {allocation.expiryDate
                            ? ` — صلاحية ${allocation.expiryDate}`
                            : ' — بلا تاريخ صلاحية'}
                        </span>
                        <Badge variant="outline">
                          {allocation.quantity} {selectedItem.unit}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {!isFefoPreviewFetching && fefoPreview && !fefoPreview.canFulfill && (
                  <p className="mt-2 text-destructive">
                    لا تكفي الدفعات الصالحة للكمية المطلوبة. الدفعات المنتهية لا تدخل في الصرف.
                  </p>
                )}
                {!isFefoPreviewFetching && fefoPreview?.canFulfill && fefoPreview.allocations.length === 0 && (
                  <p className="mt-2 text-muted-foreground">
                    لا توجد دفعات قابلة للصرف لهذه المادة.
                  </p>
                )}
              </div>
            )}

            {/* Internal delivery note */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="internalDeliveryNoteNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>رقم مذكرة التسليم الداخلية *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="مثال: داخلي-2026-001"
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
                name="internalDeliveryNoteDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>تاريخ مذكرة التسليم الداخلية *</FormLabel>
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
            </div>

            <FormField
              control={form.control}
              name="deliveryDestination"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>جهة التسليم *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      setPendingConfirm(false);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر جهة التسليم..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="administrative_building">مبنى إداري</SelectItem>
                      <SelectItem value="health_facility">مرفق صحي</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Recipient */}
            <FormField
              control={form.control}
              name="recipientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>اسم المستلم / الجهة *</FormLabel>
                  <CatalogCombobox
                    value={field.value && field.value > 0 ? field.value.toString() : ''}
                    open={recipientPickerOpen}
                    onOpenChange={setRecipientPickerOpen}
                    onValueChange={(value) => {
                      field.onChange(Number(value));
                      setPendingConfirm(false);
                    }}
                    placeholder="اختر الجهة المستلمة..."
                    searchPlaceholder="ابحث باسم المستلم أو الجهة..."
                    emptyMessage="لا توجد جهة مستلمة مطابقة"
                    loading={!recipients}
                    options={(recipients ?? []).map((recipient: Recipient) => ({
                      value: recipient.id.toString(),
                      searchValue: `${recipient.id} ${recipient.name}`,
                      label: recipient.name,
                    }))}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Exit Reason */}
            <FormField
              control={form.control}
              name="exitReasonId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>سبب الإخراج *</FormLabel>
                  <CatalogCombobox
                    value={field.value && field.value > 0 ? field.value.toString() : ''}
                    open={reasonPickerOpen}
                    onOpenChange={setReasonPickerOpen}
                    onValueChange={(value) => {
                      field.onChange(Number(value));
                      setPendingConfirm(false);
                    }}
                    placeholder="اختر سبب الإخراج..."
                    searchPlaceholder="ابحث في أسباب الإخراج..."
                    emptyMessage="لا يوجد سبب إخراج مطابق"
                    loading={!exitReasons}
                    options={(exitReasons ?? []).map((reason: ExitReason) => ({
                      value: reason.id.toString(),
                      searchValue: `${reason.id} ${reason.name}`,
                      label: reason.name,
                    }))}
                  />
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
              <div className="p-4 bg-warning/10 border border-warning/30 rounded-md text-sm flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-1">تأكيد عملية الإخراج</p>
                  <p className="text-foreground/80">
                    سيتم تسجيل إخراج <strong>{selectedItem?.name}</strong> بكمية{' '}
                    <strong>
                      {watchQuantity} {selectedItem?.unit}
                    </strong>{' '}
                    بمذكرة داخلية رقم{' '}
                    <strong>{form.getValues('internalDeliveryNoteNumber')}</strong>.
                    {fefoPreview?.allocations.length ? (
                      <> سيصرف النظام تلقائيًا من {fefoPreview.allocations.length} دفعة حسب FEFO.</>
                    ) : null}
                    {wouldBeBelowMin && (
                      <span className="text-warning font-medium">
                        {' '}(تحذير: سيكون الرصيد تحت الحد الأدنى)
                      </span>
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
                variant="destructive"
                disabled={
                  mutation.isPending ||
                  quantityExceedsStock ||
                  batchStockInsufficient ||
                  isFefoPreviewFetching
                }
                className="gap-2"
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
