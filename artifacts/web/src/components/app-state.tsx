import { AlertCircle, LoaderCircle, ShieldAlert, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LoadingState({
  label = 'جاري تحميل الصفحة...',
}: {
  label?: string;
}) {
  return (
    <div
      className="flex min-h-[16rem] items-center justify-center p-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function ConnectionErrorState({
  onRetry,
  title = 'تعذر الاتصال',
  description = 'لم يتمكن التطبيق من الوصول إلى الخادم. تحقق من الاتصال ثم حاول مرة أخرى.',
}: {
  onRetry: () => void;
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="flex min-h-[16rem] items-center justify-center p-6"
      role="alert"
      dir="rtl"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <WifiOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Button type="button" onClick={onRetry} className="min-w-32">
          إعادة المحاولة
        </Button>
      </div>
    </div>
  );
}

export function AccessDeniedState({ onBack }: { onBack: () => void }) {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-6"
      role="alert"
      dir="rtl"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center shadow-xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/15 text-warning-foreground">
          <ShieldAlert className="h-7 w-7" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold">لا تملك الصلاحية</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            تحتاج إلى صلاحية مناسبة للوصول إلى هذه الصفحة. يمكنك العودة إلى لوحة التحكم.
          </p>
        </div>
        <Button type="button" onClick={onBack}>
          العودة إلى لوحة التحكم
        </Button>
      </div>
    </div>
  );
}

export function UnexpectedErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center p-6" role="alert" dir="rtl">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <h2 className="text-lg font-bold">حدث خطأ غير متوقع</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          تعذر عرض هذه الصفحة. أعد المحاولة، وإذا استمرت المشكلة أعد تشغيل التطبيق.
        </p>
        <Button type="button" onClick={onRetry}>
          إعادة تحميل الصفحة
        </Button>
      </div>
    </div>
  );
}