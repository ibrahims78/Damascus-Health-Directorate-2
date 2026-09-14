import {
  useGetCurrentUser,
  useLogout,
  getListAlertsQueryOptions,
  getListAlertsQueryKey,
  getGetCurrentUserQueryKey,
  useMarkAllAlertsRead,
  useMarkAlertRead,
  useResolveAlert,
  type Alert,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  LogOut,
  Moon,
  Sun,
  User as UserIcon,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  Package,
  Wrench,
  Settings,
  HelpCircle,
} from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  below_min: 'نقص بالمخزون',
  near_expiry: 'قريب الانتهاء / منتهي',
  equipment_maintenance: 'صيانة معدة',
  equipment_below_min: 'نقص تجهيزات',
};

function severityIcon(severity: Alert['severity']) {
  if (severity === 'critical')
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (severity === 'warning')
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
}

function entityIcon(entityType: Alert['entityType']) {
  return entityType === 'item'
    ? <Package className="h-3 w-3" />
    : <Wrench className="h-3 w-3" />;
}

function entityPath(alert: Alert): string {
  return alert.entityType === 'item'
    ? `/items/${alert.entityId}/edit`
    : `/equipment/${alert.entityId}/edit`;
}

// ─── SSE hook — connects once, refetches alerts on push ───────────────────────

function useAlertSSE(onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (import.meta.env.VITE_OFFLINE_MODE === '1') {
      const interval = window.setInterval(() => onUpdateRef.current(), 60_000);
      return () => window.clearInterval(interval);
    }

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2_000;
    let stopped = false;

    function connect() {
      if (stopped) return;
      es = new EventSource('/api/alerts/stream', { withCredentials: true });

      es.addEventListener('message', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'update') {
            onUpdateRef.current();
          }
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener('error', () => {
        es?.close();
        es = null;
        if (!stopped) {
          retryTimeout = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            connect();
          }, retryDelay);
        }
      });

      es.addEventListener('open', () => {
        retryDelay = 2_000; // reset on successful connect
      });
    }

    connect();

    return () => {
      stopped = true;
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);
}

// ─── AlertRow ─────────────────────────────────────────────────────────────────

interface AlertRowProps {
  alert: Alert;
  isAdmin: boolean;
  onNavigate: (path: string) => void;
}

function AlertRow({ alert, isAdmin, onNavigate }: AlertRowProps) {
  const queryClient = useQueryClient();
  const markRead = useMarkAlertRead();
  const resolve = useResolveAlert();

  const handleMarkRead = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (alert.isRead) return;
      // Optimistic: mark as read immediately
      queryClient.setQueryData(
        getListAlertsQueryKey(),
        (old: Alert[] | undefined) =>
          old?.map(a => a.dbId === alert.dbId ? { ...a, isRead: true } : a) ?? []
      );
      markRead.mutate(
        { id: alert.dbId },
        { onSettled: () => queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }) }
      );
    },
    [alert.dbId, alert.isRead, markRead, queryClient]
  );

  const handleResolve = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Optimistic: remove the alert from the list immediately
      queryClient.setQueryData(
        getListAlertsQueryKey(),
        (old: Alert[] | undefined) =>
          old?.filter(a => a.dbId !== alert.dbId) ?? []
      );
      resolve.mutate(
        { id: alert.dbId },
        {
          onError: () => queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }),
          onSettled: () => queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }),
        }
      );
    },
    [alert.dbId, resolve, queryClient]
  );

  const handleNavigate = useCallback(() => {
    // Optimistic: mark as read immediately when navigating
    if (!alert.isRead) {
      queryClient.setQueryData(
        getListAlertsQueryKey(),
        (old: Alert[] | undefined) =>
          old?.map(a => a.dbId === alert.dbId ? { ...a, isRead: true } : a) ?? []
      );
      markRead.mutate(
        { id: alert.dbId },
        { onSettled: () => queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }) }
      );
    }
    onNavigate(entityPath(alert));
  }, [alert, markRead, queryClient, onNavigate]);

  const borderColor =
    alert.severity === 'critical'
      ? 'border-r-destructive'
      : alert.severity === 'warning'
        ? 'border-r-amber-500'
        : 'border-r-blue-500';

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2.5 border-b last:border-0 border-r-2 transition-colors group',
        borderColor,
        alert.isRead
          ? 'bg-background opacity-60 hover:opacity-80'
          : 'bg-secondary/40 hover:bg-secondary/70',
        'cursor-pointer'
      )}
      onClick={handleNavigate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleNavigate();
        }
      }}
      role="button"
      tabIndex={0}
      title="اضغط للانتقال إلى السجل"
    >
      {/* Severity icon */}
      <div className="mt-0.5">{severityIcon(alert.severity)}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-sm font-medium inline-flex items-center gap-1',
            alert.severity === 'critical'
              ? 'bg-destructive/10 text-destructive'
              : alert.severity === 'warning'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          )}>
            {entityIcon(alert.entityType)}
            {TYPE_LABEL[alert.type] ?? alert.type}
          </span>
          {!alert.isRead && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
          )}
        </div>
        <p className="text-xs text-foreground mt-1 leading-relaxed font-medium truncate">
          {alert.entityName ?? alert.itemName ?? '—'}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
          {alert.message}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
        {!alert.isRead && (
          <button
            onClick={handleMarkRead}
            title="تأشير كمقروء"
            aria-label="تأشير التنبيه كمقروء"
            className="text-muted-foreground hover:text-primary p-0.5 rounded"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </button>
        )}
        {isAdmin && (
          <button
            onClick={handleResolve}
            title="تم المعالجة"
            aria-label="تحديد التنبيه كتمت معالجته"
            className="text-muted-foreground hover:text-green-600 p-0.5 rounded"
            disabled={resolve.isPending}
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 mt-auto" aria-hidden="true" />
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

export function Header() {
  const { theme, setTheme } = useTheme();
  const { data: user } = useGetCurrentUser();
  const logout = useLogout();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const markAllRead = useMarkAllAlertsRead();
  const logoutStarted = useRef(false);
  const { data: systemSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings', { credentials: 'include' });
      if (!response.ok) throw new Error('فشل جلب إعدادات المستودع');
      return response.json() as Promise<{ orgName: string }>;
    },
    refetchOnWindowFocus: true,
  });

  // Fetch alerts — no polling interval; SSE pushes updates instead
  const { data: alerts, isError: alertsError, isFetching: alertsFetching, refetch: refetchAlerts } = useQuery({
    ...getListAlertsQueryOptions(),
    // Fallback polling every 10 min in case SSE drops and doesn't reconnect
    refetchInterval: 10 * 60 * 1_000,
  });

  // SSE: invalidate cache on push → triggers re-fetch
  useAlertSSE(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    }, [queryClient])
  );

  const handleLogout = () => {
    if (logoutStarted.current) return;
    logoutStarted.current = true;
    // Clear auth-scoped state immediately so the login page can render without
    // retaining the previous user in the query cache.
    queryClient.clear();
    // Complete the server request when possible, then perform a real document
    // navigation. This clears any mounted auth-scoped React state and avoids
    // redirect loops while the protected tree is being unmounted.
    let redirected = false;
    const redirect = () => {
      if (redirected) return;
      redirected = true;
      window.location.replace('/login');
    };
    const timeout = window.setTimeout(redirect, 1500);
    void logout.mutateAsync()
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(timeout);
        redirect();
      });
  };

  const roleLabel: Record<string, string> = {
    admin: 'مدير نظام',
    warehouse_manager: 'أمين مستودع',
    viewer: 'مراقب',
  };

  const isAdmin = user?.role === 'admin';

  const unread = alerts?.filter(a => !a.isRead) ?? [];
  const critical = alerts?.filter(a => a.severity === 'critical') ?? [];
  const warning = alerts?.filter(a => a.severity === 'warning') ?? [];
  const unreadCount = unread.length;
  const hasCritical = critical.some(a => !a.isRead);

  const handleMarkAllRead = () => {
    // Optimistic update: mark all alerts as read immediately in the cache
    queryClient.setQueryData(
      getListAlertsQueryKey(),
      (old: Alert[] | undefined) => old?.map(a => ({ ...a, isRead: true })) ?? []
    );
    markAllRead.mutate(undefined, {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }),
      onError: () =>
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() }),
    });
  };

  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <div className="min-w-0 max-w-[55%] hidden sm:block text-right" dir="rtl">
        <p className="truncate text-sm font-semibold text-foreground">
          {systemSettings?.orgName ?? 'مستودعات مديرية صحة دمشق'}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {/* ── Help center ── */}
        {location === '/' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation('/help')}
            className="gap-1.5 border-primary/25 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary"
            aria-label="فتح مركز المساعدة"
            data-testid="button-open-help"
          >
            <HelpCircle className="h-4 w-4" />
            <span>مساعدة</span>
          </Button>
        )}

        {/* ── Alerts bell ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={unreadCount > 0 ? `التنبيهات — ${unreadCount} غير مقروء` : 'التنبيهات'}
              onClick={() => { void refetchAlerts(); }}
            >
              <Bell className={cn(
                'h-5 w-5',
                unreadCount > 0 ? 'text-foreground' : 'text-muted-foreground'
              )} />
              {unreadCount > 0 && (
                <span
                  className={cn(
                    'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full',
                    'text-[10px] font-bold flex items-center justify-center px-1 text-white',
                    hasCritical
                      ? 'bg-destructive animate-pulse'
                      : 'bg-amber-500'
                  )}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-96 p-0" sideOffset={8}>
            {/* Header bar */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b">
              <DropdownMenuLabel className="p-0 text-sm font-semibold">
                التنبيهات
                {(alerts?.length ?? 0) > 0 && (
                  <span className="mr-1.5 text-xs text-muted-foreground font-normal">
                    ({unreadCount} غير مقروء / {alerts?.length} إجمالي)
                  </span>
                )}
              </DropdownMenuLabel>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markAllRead.isPending}
                  className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  تأشير الكل كمقروء
                </button>
              )}
            </div>

            {/* Empty/error state */}
            {alertsError && (
              <div className="px-4 py-8 text-center text-sm text-destructive">
                تعذر تحميل التنبيهات. اضغط على الجرس للمحاولة مرة أخرى.
              </div>
            )}
            {(alerts?.length ?? 0) === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-20" />
                {alertsFetching ? 'جاري تحميل التنبيهات...' : 'لا توجد تنبيهات نشطة'}
              </div>
            )}

            {/* Critical section */}
            {critical.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-destructive/5 border-b flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-[11px] font-semibold text-destructive uppercase tracking-wide">
                    حرج ({critical.length})
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {critical.map(alert => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      isAdmin={isAdmin}
                      onNavigate={setLocation}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Warning section */}
            {warning.length > 0 && (
              <>
                <div className={cn(
                  'px-3 py-1.5 border-b flex items-center gap-1.5',
                  critical.length > 0 ? 'border-t' : '',
                  'bg-amber-500/5'
                )}>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                    تحذير ({warning.length})
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {warning.map(alert => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      isAdmin={isAdmin}
                      onNavigate={setLocation}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Footer */}
            {(alerts?.length ?? 0) > 0 && (
              <>
                <DropdownMenuSeparator className="my-0" />
                <div
                  className="flex items-center justify-center gap-1.5 py-2.5 text-sm text-primary cursor-pointer hover:bg-secondary/40 transition-colors"
                  onClick={() => setLocation('/reports')}
                >
                  <span>عرض الكل في التقارير</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ── Theme toggle ── */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        {/* ── User menu ── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 pl-2"
              aria-label={`قائمة المستخدم${user?.fullName ? `: ${user.fullName}` : ''}`}
            >
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0',
                user?.role === 'admin'
                  ? 'bg-primary'
                  : user?.role === 'warehouse_manager'
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
              )}>
                {user?.fullName
                  ? user.fullName.split(' ').map(w => w[0]).slice(0, 2).join('')
                  : <UserIcon className="h-4 w-4" />}
              </div>
              <div className="hidden md:flex flex-col items-start">
                <span className="text-sm font-medium leading-none">{user?.fullName}</span>
                <span className="text-xs text-muted-foreground mt-1">{roleLabel[user?.role ?? 'viewer'] ?? 'مراقب'}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal pb-2">
              <div className="flex items-center gap-2.5">
                <div className={cn(
                  'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0',
                  user?.role === 'admin'
                    ? 'bg-primary'
                    : user?.role === 'warehouse_manager'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                )}>
                  {user?.fullName
                    ? user.fullName.split(' ').map(w => w[0]).slice(0, 2).join('')
                    : <UserIcon className="h-4 w-4" />}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-sm truncate">{user?.fullName}</span>
                  <span className="text-xs text-muted-foreground">{roleLabel[user?.role ?? 'viewer'] ?? 'مراقب'}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setLocation('/settings')}
              className="gap-2 cursor-pointer"
            >
              <Settings className="h-4 w-4" />
              حسابي والإعدادات
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
