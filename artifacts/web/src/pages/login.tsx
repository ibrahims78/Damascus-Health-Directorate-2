import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLogin, useGetCurrentUser, useGetSetupStatus } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { AuthShell } from '@/components/auth/auth-shell';
import { ConnectionErrorState, LoadingState } from '@/components/app-state';
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from '@/components/ui/form';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { storeCsrfToken } from '@/lib/csrf-client';

const loginSchema = z.object({
  username: z.string().min(1, 'اسم المستخدم مطلوب'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const [location, setLocation] = useLocation();
  const {
    data: user,
    isLoading: isCheckingUser,
    isError: isUserError,
    error: userError,
    refetch: refetchUser,
  } = useGetCurrentUser();
  const {
    data: setupStatus,
    isLoading: isCheckingSetup,
    isError: isSetupError,
    refetch: refetchSetup,
  } = useGetSetupStatus();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        const loginData = data as unknown as {
          csrfToken?: string;
          mustChangePassword?: boolean;
        };
        storeCsrfToken(loginData.csrfToken ?? null);
        if (loginData.mustChangePassword) {
          setLocation('/change-password');
        } else {
          setLocation('/');
        }
      },
      onError: (err: any) => {
        if (err?.response?.status === 401) {
          setErrorMsg('اسم المستخدم أو كلمة المرور غير صحيحة.');
        } else {
          setErrorMsg('حدث خطأ أثناء الاتصال بالخادم. حاول مرة أخرى.');
        }
      }
    }
  });

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!isCheckingSetup && setupStatus?.needsSetup && location !== '/setup') {
      setLocation('/setup');
    }
  }, [isCheckingSetup, setupStatus, location, setLocation]);

  useEffect(() => {
    if (!isCheckingUser && user && location !== '/') {
      setLocation('/');
    }
  }, [isCheckingUser, user, location, setLocation]);

  const userStatus = (userError as unknown as { response?: { status?: number } } | null | undefined)
    ?.response?.status;
  const hasConnectionError =
    isSetupError || (isUserError && userStatus !== 401 && userStatus !== 403);

  if (isCheckingUser || isCheckingSetup) {
    return (
      <AuthShell>
        <LoadingState label="جاري تجهيز تسجيل الدخول..." />
      </AuthShell>
    );
  }
  if (hasConnectionError) {
    return (
      <AuthShell>
        <ConnectionErrorState
          onRetry={() => {
            void refetchUser();
            void refetchSetup();
          }}
          description="تعذر التحقق من حالة النظام. تحقق من اتصال الخادم ثم حاول مرة أخرى."
        />
      </AuthShell>
    );
  }
  if (setupStatus?.needsSetup || user) return null;

  const onSubmit = (data: LoginFormValues) => {
    setErrorMsg(null);
    loginMutation.mutate({ data });
  };

  return (
    <AuthShell>
          <div className="mb-6 space-y-1 text-right">
            <h2 className="text-xl font-bold">تسجيل الدخول</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              أدخل بيانات حسابك للوصول إلى لوحة التحكم وإدارة المخزون.
            </p>
          </div>
          
          {errorMsg && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>اسم المستخدم</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="أدخل اسم المستخدم"
                        autoComplete="username"
                        {...field}
                        dir="ltr"
                        className="text-right"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>كلمة المرور</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="أدخل كلمة المرور"
                        autoComplete="current-password"
                        {...field}
                        dir="ltr"
                        className="text-right"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="mt-6 w-full"
                size="lg"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? 'جاري تسجيل الدخول...' : 'دخول'}
              </Button>
            </form>
          </Form>
    </AuthShell>
  );
}