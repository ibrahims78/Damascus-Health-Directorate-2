import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, ArrowRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import logoUrl from '@assets/damascus-health-directorate-mark.png';

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md border shadow-xl">
        <CardContent className="space-y-5 p-6 text-center sm:p-8">
          <img
            src={logoUrl}
            alt="شعار مستودعات مديرية صحة دمشق"
            className="mx-auto h-20 w-20 rounded-full border bg-white p-2 object-contain shadow-sm"
          />
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-destructive">
              <AlertCircle className="h-6 w-6" aria-hidden="true" />
              <span className="text-sm font-bold">خطأ 404</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              الصفحة غير موجودة
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              عذرًا، لا يمكن العثور على الصفحة المطلوبة. ربما تغير الرابط أو لم يعد متاحًا.
            </p>
          </div>
          <Button type="button" onClick={() => setLocation('/')} className="w-full sm:w-auto">
            <Home className="h-4 w-4" aria-hidden="true" />
            العودة إلى لوحة التحكم
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
