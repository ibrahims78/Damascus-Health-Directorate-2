import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LogIn } from 'lucide-react';

export function SessionExpiryDialog({
  open,
  onContinue,
}: {
  open: boolean;
  onContinue: () => void;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent dir="rtl" className="max-w-md text-right">
        <AlertDialogHeader className="text-right">
          <AlertDialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" aria-hidden="true" />
            انتهت الجلسة
          </AlertDialogTitle>
          <AlertDialogDescription className="leading-6">
            انتهت صلاحية جلسة الدخول حفاظًا على أمان حسابك. سجّل الدخول مرة أخرى للمتابعة.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row-reverse gap-2 sm:space-x-0">
          <AlertDialogAction onClick={onContinue}>
            العودة إلى تسجيل الدخول
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}