import { useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useGetCurrentUser, useChangePassword } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/auth/password-input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, ShieldAlert } from 'lucide-react';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'كلمة المرور الحالية مطلوبة'),
    newPassword: z
      .string()
      .min(12, 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل')
      .regex(/[a-z]/, 'يجب أن تحتوي على حرف صغير')
      .regex(/[A-Z]/, 'يجب أن تحتوي على حرف كبير')
      .regex(/[0-9]/, 'يجب أن تحتوي على رقم')
      .regex(/[^a-zA-Z0-9]/, 'يجب أن تحتوي على رمز خاص'),
    confirmPassword: z.string().min(1, 'تأكيد كلمة المرور مطلوب'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirmPassword'],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export function ChangePasswordPage() {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetCurrentUser();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [forceMode] = useState(() => Boolean((user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword));

  const changeMutation = useChangePassword({
    mutation: {
      onSuccess: () => {
        setLocation('/');
      },
      onError: (err: any) => {
        const status = err?.response?.status;
        if (status === 401) setErrorMsg('كلمة المرور الحالية غير صحيحة.');
        else if (status === 400) setErrorMsg('كلمة المرور الجديدة لا تستوفي السياسة المطلوبة.');
        else setErrorMsg('حدث خطأ أثناء تغيير كلمة المرور. حاول مرة أخرى.');
      },
    },
  });

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center p-4" dir="rtl">
      <Card className="w-full">
        <CardHeader className="space-y-3">
          {forceMode && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" />
              <span>تم إنشاء حسابك بكلمة مرور مؤقتة — غيّرها قبل متابعة العمل.</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle>تغيير كلمة المرور</CardTitle>
          </div>
          <CardDescription>
            كلمة المرور الجديدة: 12 حرفاً على الأقل، وتحتوي حرفاً كبيراً وصغيراً ورقماً ورمزاً خاصاً.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {errorMsg && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) =>
                changeMutation.mutate({
                  data: {
                    currentPassword: values.currentPassword,
                    newPassword: values.newPassword,
                  },
                }),
              )}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>كلمة المرور الحالية</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="current-password" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>كلمة المرور الجديدة</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>تأكيد كلمة المرور الجديدة</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={changeMutation.isPending}>
                {changeMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
