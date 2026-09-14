import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  useGetItem, 
  useCreateItem, 
  useUpdateItem,
  useListCategories,
  type Category,
} from '@workspace/api-client-react';
import { ArrowRight, Save, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getApiErrorMessage, isValidIsoDate } from '@/lib/item-validation';

const itemSchema = z.object({
  name: z.string().trim().min(2, 'الاسم مطلوب ويجب أن يكون حرفين على الأقل'),
  code: z.string().trim().optional().nullable(),
  categoryId: z.coerce.number().int('التصنيف غير صالح').positive('التصنيف غير صالح').optional().nullable(),
  itemType: z.string().default('item'),
  unit: z.string().trim().min(1, 'الوحدة مطلوبة (مثال: حبة، علبة، إلخ)'),
  initialStock: z.coerce.number().int('الكمية يجب أن تكون عدداً صحيحاً').min(0, 'لا يمكن أن تكون الكمية سالبة').default(0),
  minStock: z.coerce.number().int('الحد الأدنى يجب أن يكون عدداً صحيحاً').min(0, 'لا يمكن أن يكون الحد الأدنى سالباً').default(0),
  expiryDate: z.string().optional().nullable().refine((value) => !value || isValidIsoDate(value), 'تاريخ الصلاحية غير صالح'),
  batchNumber: z.string().trim().optional().nullable(),
  location: z.string().trim().optional().nullable(),
  supplier: z.string().trim().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type ItemFormValues = z.infer<typeof itemSchema>;

/* ──────────────────────────── Loading skeleton ──────────────────────────── */

function FormSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-7 w-48" />
      </div>
      <div className="bg-card border rounded-lg shadow-sm p-6 space-y-6">
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

/* ──────────────────────────── Form component ────────────────────────────── */

export function ItemForm({ itemId }: { itemId?: number }) {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  // ── Category quick-add dialog state ──
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'consumable' | 'equipment'>('consumable');
  const [catError, setCatError] = useState('');
  const [submitError, setSubmitError] = useState('');

  // ── Units from settings ──
  const [showCustomUnit, setShowCustomUnit] = useState(false);
  // Phase 2: standard units come from the managed catalog (/api/units)
  // instead of the free-text settings list.
  const { data: unitsData } = useQuery({
    queryKey: ['units-catalog'],
    queryFn: async () => {
      const res = await fetch('/api/units', { credentials: 'include' });
      if (!res.ok) return [] as Array<{ name: string; isActive: boolean }>;
      return res.json() as Promise<Array<{ name: string; isActive: boolean }>>;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const unitOptions: string[] = Array.isArray(unitsData)
    ? unitsData.filter((u) => u.isActive !== false).map((u) => u.name)
    : [];

  const { data: categories, refetch: refetchCategories } = useListCategories();
  const isEditing = !!itemId;
  
  // Use enabled and queryKey options for Orval hook
  const { data: item, isLoading: isLoadingItem } = useGetItem(
    itemId as number, 
    { query: { enabled: isEditing, queryKey: ['item', itemId] } }
  );

  const createMutation = useCreateItem();
  const updateMutation = useUpdateItem();

  // Mutation to create a new category inline
  const createCatMutation = useMutation({
    mutationFn: async (data: { name: string; type: string }) => {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'فشل إضافة التصنيف');
      }
      return res.json() as Promise<Category>;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['listCategories'] });
      qc.invalidateQueries({ queryKey: ['/api/categories'] });
      refetchCategories();
      // Auto-select the new category
      form.setValue('categoryId', created.id);
      setCatDialogOpen(false);
      setNewCatName('');
      setCatError('');
      toast.success(`تم إضافة تصنيف "${created.name}" بنجاح`);
    },
    onError: (err: Error) => {
      const message = getApiErrorMessage(err, 'تعذر إضافة التصنيف');
      setCatError(message);
      toast.error(message);
    },
  });

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: '',
      code: '',
      categoryId: undefined,
      itemType: 'item',
      unit: 'حبة',
      initialStock: 0,
      minStock: 10,
      expiryDate: '',
      batchNumber: '',
      location: '',
      supplier: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (isEditing && item) {
      form.reset({
        name: item.name,
        code: item.code || '',
        categoryId: item.categoryId || undefined,
        itemType: item.itemType,
        unit: item.unit,
        minStock: item.minStock,
        expiryDate: item.expiryDate ? item.expiryDate.split('T')[0] : '',
        batchNumber: item.batchNumber || '',
        location: item.location || '',
        supplier: item.supplier || '',
        notes: item.notes || '',
      });
    }
  }, [item, isEditing, form]);

  const onSubmit = (data: ItemFormValues) => {
    setSubmitError('');
    const normalizedData = {
      ...data,
      name: data.name.trim(),
      code: data.code?.trim() || null,
      unit: data.unit.trim(),
      batchNumber: data.batchNumber?.trim() || null,
      location: data.location?.trim() || null,
      supplier: data.supplier?.trim() || null,
      notes: data.notes?.trim() || null,
      categoryId: data.categoryId || null,
    };

    if (isEditing) {
      updateMutation.mutate({ 
        id: itemId!, 
        data: {
          ...normalizedData,
        } 
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['items-kpi'] });
          toast.success("تم تعديل المادة بنجاح");
          setLocation('/items');
        },
        onError: (error) => {
          const message = getApiErrorMessage(error, 'حدث خطأ أثناء حفظ المادة');
          setSubmitError(message);
          toast.error(message);
        },
      });
    } else {
      createMutation.mutate({ 
        data: {
          ...normalizedData,
          currentStock: normalizedData.initialStock ?? 0,
        } 
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ['items-kpi'] });
          toast.success("تمت إضافة المادة بنجاح");
          setLocation('/items');
        },
        onError: (error) => {
          const message = getApiErrorMessage(error, 'حدث خطأ أثناء إضافة المادة');
          setSubmitError(message);
          toast.error(message);
        },
      });
    }
  };

  if (isEditing && isLoadingItem) {
    return (
      <div className="p-6">
        <FormSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" aria-label="العودة إلى المواد" onClick={() => setLocation('/items')}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {isEditing ? 'تعديل مادة' : 'إضافة مادة جديدة'}
            </h1>
            <p className="text-sm text-muted-foreground">أدخل بيانات المادة كما تظهر في المخزون والدفعات.</p>
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg shadow-sm p-6">
        {submitError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>تعذر حفظ المادة</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>اسم المادة *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="مثال: باراسيتامول 500 مغ" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>رمز المادة (الباركود)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ''} dir="ltr" className="text-right" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>التصنيف</FormLabel>
                    <div className="flex gap-2">
                      <Select 
                        value={field.value ? field.value.toString() : ''} 
                        onValueChange={(val) => field.onChange(parseInt(val))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="اختر التصنيف" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories?.length === 0 && (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              لا توجد تصنيفات — أضف واحداً بالزر +
                            </div>
                          )}
                          {categories?.map((cat: Category) => (
                            <SelectItem key={cat.id} value={cat.id.toString()}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="إضافة تصنيف جديد"
                         aria-label="إضافة تصنيف جديد"
                         onClick={() => { setCatError(''); setCatDialogOpen(true); }}
                        className="flex-shrink-0"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الوحدة *</FormLabel>
                    {unitOptions.length > 0 && !showCustomUnit ? (
                      <div className="flex gap-2">
                        <Select
                          value={field.value ?? ''}
                          onValueChange={(val) => {
                            if (val === '__custom__') {
                              setShowCustomUnit(true);
                              field.onChange('');
                            } else {
                              field.onChange(val);
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="اختر الوحدة" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {unitOptions.map((u) => (
                              <SelectItem key={u} value={u}>{u}</SelectItem>
                            ))}
                            {field.value && !unitOptions.includes(field.value) && (
                              <SelectItem value={field.value}>
                                {field.value} (الوحدة الحالية غير موجودة في القائمة)
                              </SelectItem>
                            )}
                            <SelectItem value="__custom__" className="text-muted-foreground italic border-t mt-1 pt-1">
                              أخرى (إدخال يدوي)...
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="اكتب الوحدة..."
                            autoFocus={showCustomUnit}
                          />
                        </FormControl>
                        {unitOptions.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-shrink-0 text-xs"
                            onClick={() => { setShowCustomUnit(false); field.onChange(''); }}
                          >
                            من القائمة
                          </Button>
                        )}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isEditing && (
                <FormField
                  control={form.control}
                  name="initialStock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الكمية الحالية (الرصيد الافتتاحي)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="minStock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>حد النواقص (الحد الأدنى)</FormLabel>
                    <FormControl>
                       <Input type="number" min={0} step={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>تاريخ الصلاحية</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ''} />
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
                    <FormLabel>رقم الطبخة (Batch Number)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ''} dir="ltr" className="text-right" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>مكان التخزين (الرف / القسم)</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>الجهة الموردة</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value || ''} className="h-24" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setLocation('/items')}>
                إلغاء
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="gap-2">
                <Save className="w-4 h-4" />
                {isEditing ? 'حفظ التعديلات' : 'إضافة المادة'}
              </Button>
            </div>
          </form>
        </Form>
      </div>

      {/* ── Quick-add category dialog ── */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة تصنيف جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">اسم التصنيف *</Label>
              <Input
                id="cat-name"
                placeholder="مثال: مستهلكات طبية، أدوية، معدات..."
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim(), type: newCatType });
                    else setCatError('اسم التصنيف مطلوب');
                  }
                }}
                autoFocus
              />
              {catError && <p className="text-sm text-destructive" role="alert">{catError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>نوع التصنيف *</Label>
              <Select value={newCatType} onValueChange={(v) => setNewCatType(v as 'consumable' | 'equipment')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consumable">مستهلكات (مواد)</SelectItem>
                  <SelectItem value="equipment">تجهيزات</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim(), type: newCatType });
                else setCatError('اسم التصنيف مطلوب');
              }}
              disabled={!newCatName.trim() || createCatMutation.isPending}
              className="gap-2"
            >
              {createCatMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {createCatMutation.isPending ? 'جاري الإضافة...' : 'إضافة التصنيف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}