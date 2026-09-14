import type { ReactNode } from 'react';
import logoUrl from '@assets/damascus-health-directorate-logo.png';

export const APP_NAME = 'مستودعات مديرية صحة دمشق';
export const APP_LOCATION = 'دمشق';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6"
      dir="rtl"
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg items-center justify-center">
        <div className="w-full overflow-hidden rounded-2xl border bg-card shadow-xl shadow-primary/5">
          <div className="border-b bg-muted/40 px-6 py-8 text-center sm:px-8">
            <img
              src={logoUrl}
              alt={`شعار ${APP_NAME}`}
              className="mx-auto mb-4 h-24 w-24 rounded-full border bg-white p-2 object-contain shadow-md"
            />
            <p className="mb-2 text-xs font-semibold tracking-wide text-primary">
              {APP_LOCATION} · نظام إدارة المخزون
            </p>
            <h1 className="text-xl font-bold leading-relaxed text-foreground sm:text-2xl">
              {APP_NAME}
            </h1>
          </div>
          <div className="p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}