import { useQuery } from '@tanstack/react-query';
import {
  useGetCurrentUser,
  getGetDashboardStatsQueryOptions,
  getGetDashboardChartsQueryOptions,
  type DashboardStats,
  type DashboardCharts,
  type RecentTransaction,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Package,
  Clock,
  ArrowRightLeft,
  Stethoscope,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  ShieldAlert,
  BoxSelect,
  CalendarDays,
  Wrench,
  TrendingDown,
  TrendingUp,
  Archive,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';
import { Link, useLocation } from 'wouter';
import { useState, useEffect, type ReactNode } from 'react';
import type { TooltipProps } from 'recharts';

// ─── Custom dark-mode-safe Tooltip ───────────────────────────────────────────

type ChartTooltipEntry = {
  name?: string | number;
  value?: number;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

function ChartTooltip({ active, payload, label, labelFormatter, itemFormatter }: {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: string | number;
  labelFormatter?: (label: string | number, payload: ChartTooltipEntry[]) => ReactNode;
  itemFormatter?: (value: number, name: string, entry: ChartTooltipEntry) => [string, string];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-md" dir="rtl">
      {label && (
        <p className="mb-1 font-medium text-foreground">
            {labelFormatter ? labelFormatter(label, payload ?? []) : label}
        </p>
      )}
      {payload.map((entry, i) => {
        const value = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
        const name = String(entry.name ?? '');
        const [valStr, nameStr] = itemFormatter
          ? itemFormatter(value, name, entry)
          : [`${value}`, name];
        return (
          <div key={i} className="flex items-center gap-2 text-foreground/90">
            {entry.color && (
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
            )}
            <span className="text-muted-foreground">{nameStr}:</span>
            <span className="font-medium tabular-nums">{valStr}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--primary))',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
];

const REFETCH_INTERVAL = 3 * 60 * 1_000; // 3 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Arabic-aware pluralization for a number of days */
function formatDays(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  return new Date(iso).toLocaleDateString('ar-SY', { day: 'numeric', month: 'short' });
}

function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('ar-SY');
}

function formatUnit(value: number | null | undefined): string {
  return `${formatNumber(value)} وحدة`;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: number | string;
  icon: ReactNode;
  sub?: ReactNode;
  variant?: 'default' | 'warning' | 'danger' | 'success' | 'info';
  href?: string;
  loading?: boolean;
}

function KpiCard({ title, value, icon, sub, variant = 'default', href, loading }: KpiCardProps) {
  const variantStyles = {
    default:  { card: '',                              icon: 'text-muted-foreground', value: '' },
    warning:  { card: 'border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20',  icon: 'text-amber-500',    value: 'text-amber-600 dark:text-amber-400' },
    danger:   { card: 'border-destructive/50 bg-destructive/5',                    icon: 'text-destructive',  value: 'text-destructive' },
    success:  { card: 'border-emerald-400/60 bg-emerald-50/60 dark:bg-emerald-950/20', icon: 'text-emerald-500', value: 'text-emerald-600 dark:text-emerald-400' },
    info:     { card: 'border-blue-400/60 bg-blue-50/60 dark:bg-blue-950/20',      icon: 'text-blue-500',     value: 'text-blue-600 dark:text-blue-400' },
  }[variant];

  const inner = (
    <Card className={cn('transition-all', variantStyles.card, href && 'hover:shadow-md cursor-pointer hover:-translate-y-0.5')}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-foreground/80">{title}</CardTitle>
        <div className={cn('p-1.5 rounded-md', variant !== 'default' ? variantStyles.card : 'bg-muted/50')}>
          <span className={variantStyles.icon} aria-hidden="true">{icon}</span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-16 bg-muted rounded" />
            <div className="h-3 w-28 bg-muted rounded" />
          </div>
        ) : (
          <>
            <div className={cn('text-2xl font-bold tabular-nums', variantStyles.value)}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            {variant === 'warning' && (
              <div className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                يحتاج انتباهاً
              </div>
            )}
            {variant === 'danger' && (
              <div className="mt-2 flex items-center gap-1 text-xs font-medium text-destructive">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                حالة حرجة
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      aria-label={`${title}: ${typeof value === 'string' ? value : formatNumber(value)}`}
    >
      {inner}
    </Link>
  ) : inner;
}

// ─── Recent Transactions Table ─────────────────────────────────────────────────

// Defined outside the component — static, contains JSX elements that must not be
// recreated on every render (would generate new React element objects each time).
const TX_TYPE_META = {
  in:     { label: 'إدخال',    icon: <ArrowDownToLine className="w-3 h-3" />, color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  out:    { label: 'إخراج',    icon: <ArrowUpFromLine className="w-3 h-3" />, color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  custody_out: { label: 'تسليم عهدة', icon: <ArrowUpFromLine className="w-3 h-3" />, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  custody_return: { label: 'إعادة عهدة', icon: <ArrowDownToLine className="w-3 h-3" />, color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' },
  damage: { label: 'تلف', icon: <ShieldAlert className="w-3 h-3" />, color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  central_return: { label: 'مرتجع مركزي', icon: <ArrowUpFromLine className="w-3 h-3" />, color: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  init:   { label: 'افتتاحي', icon: <Package className="w-3 h-3" />,          color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  adjust: { label: 'تسوية',   icon: <RefreshCw className="w-3 h-3" />,        color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
} as const;

function RecentTransactionsTable({
  transactions,
  loading,
  error = false,
  onRetry,
}: {
  transactions: RecentTransaction[];
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const [, setLocation] = useLocation();

  const title = loading
    ? 'آخر العمليات'
    : transactions.length === 0
      ? 'آخر العمليات'
      : `آخر ${transactions.length === 1 ? 'عملية' : transactions.length <= 10 ? `${transactions.length} عمليات` : `${transactions.length} عملية`}`;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Link href="/transactions" className="text-xs text-primary hover:underline">
          عرض الكل ←
        </Link>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        {loading ? (
          <div className="divide-y">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="px-5 py-3 animate-pulse flex gap-3">
                <div className="h-5 w-12 bg-muted rounded" />
                <div className="flex-1 h-5 bg-muted rounded" />
                <div className="h-5 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : error && transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-destructive/70" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">تعذر تحميل أحدث العمليات.</p>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                إعادة تحميل العمليات
              </Button>
            )}
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ArrowRightLeft className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-sm text-muted-foreground">لا توجد عمليات بعد</p>
          </div>
        ) : (
          <div className="divide-y">
            {transactions.map(tx => {
              const meta = TX_TYPE_META[tx.type as keyof typeof TX_TYPE_META] ?? TX_TYPE_META.adjust;
              return (
                <div
                  key={tx.id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer group"
                  onClick={() => setLocation(tx.documentNumber ? `/transactions?search=${encodeURIComponent(tx.documentNumber)}` : '/transactions')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setLocation(tx.documentNumber ? `/transactions?search=${encodeURIComponent(tx.documentNumber)}` : '/transactions'); }}
                >
                  <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium shrink-0', meta.color)}>
                    <span aria-hidden="true">{meta.icon}</span>{meta.label}
                  </span>
                  <span className="flex-1 text-sm font-medium truncate">{tx.name}</span>
                  {tx.quantity !== null && (
                    <span className="text-sm tabular-nums text-muted-foreground shrink-0">{formatNumber(tx.quantity)}</span>
                  )}
                  <div
                    className="text-right shrink-0"
                    title={new Date(tx.createdAt).toLocaleString('ar-SY', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  >
                    <p className="text-[11px] text-muted-foreground">{timeAgo(tx.createdAt)}</p>
                    <p className="text-[10px] text-muted-foreground/60">{tx.createdByName}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Last-updated ticker ──────────────────────────────────────────────────────

function DashboardSectionError({
  section,
  onRetry,
}: {
  section: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
      role="alert"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>تعذر تحميل {section}.</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onRetry}
      >
        إعادة المحاولة
      </Button>
    </div>
  );
}

function ChartDataTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="mt-3 rounded-md border bg-muted/20 text-sm">
      <summary className="cursor-pointer px-3 py-2 font-medium text-foreground hover:bg-muted/40">
        عرض جدول البيانات
        <span className="sr-only">: {label}</span>
      </summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[420px] text-right">
          {children}
        </table>
      </div>
    </details>
  );
}

function LastUpdated({ fetchedAt }: { fetchedAt: Date | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!fetchedAt) return null;
  const diffMin = Math.floor((Date.now() - fetchedAt.getTime()) / 60_000);
  const label = diffMin < 1 ? 'الآن' : `منذ ${diffMin} د`;
  return <span className="text-xs text-muted-foreground">آخر تحديث: {label}</span>;
}

// ─── Dashboard Page ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: currentUser } = useGetCurrentUser();
  const isWarehouse = currentUser?.role === 'admin' || currentUser?.role === 'warehouse_manager';

  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery({
    ...getGetDashboardStatsQueryOptions(),
    refetchInterval: REFETCH_INTERVAL,
  });

  const {
    data: charts,
    isLoading: chartsLoading,
    isFetching: chartsFetching,
    isError: chartsError,
    refetch: refetchCharts,
  } = useQuery({
    ...getGetDashboardChartsQueryOptions(),
    refetchInterval: REFETCH_INTERVAL,
  });

  // Track last successful fetch
  useEffect(() => {
    if (stats || charts) setFetchedAt(new Date());
  }, [stats, charts]);

  const isRefreshing = statsFetching || chartsFetching;
  const handleRefresh = () => { void refetchStats(); void refetchCharts(); };

  // Determine KPI variants
  const nearExpiryVariant = (stats?.nearExpiryCount ?? 0) > 0 ? 'warning' : 'default';
  const expiredVariant    = (stats?.expiredCount ?? 0) > 0 ? 'danger' : 'default';
  const belowMinVariant   = (stats?.belowMinCount ?? 0) > 0 ? 'warning' : 'default';
  const zeroStockVariant  = (stats?.zeroStockCount ?? 0) > 0 ? 'danger' : 'default';
  const equipAlertVariant = (stats?.equipmentAlertCount ?? 0) > 0 ? 'warning' : 'default';

  const monthName = new Date().toLocaleDateString('ar-SY', { month: 'long' });

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">نظرة عامة على المستودع</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <LastUpdated fetchedAt={fetchedAt} />
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="تحديث البيانات"
              aria-label="تحديث البيانات"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Quick actions */}
        {isWarehouse && (
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/transactions/in/new">
              <Button size="sm" variant="outline" className="gap-1.5 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30">
                <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
                إدخال مواد
              </Button>
            </Link>
            <Link href="/transactions/out/new">
              <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30">
                <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden="true" />
                إخراج مواد
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Each data source reports its own failure and retry action. */}
      {statsError && (
        <DashboardSectionError section="المؤشرات وأحدث العمليات" onRetry={() => void refetchStats()} />
      )}

      {/* ── KPI Row 1: Stock status ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          loading={statsLoading}
          title="إجمالي الأصناف"
          value={stats ? formatNumber(stats.totalItems) : '—'}
          icon={<Package className="h-4 w-4" />}
          sub="صنف نشط في المستودع"
          href="/items"
        />
        <KpiCard
          loading={statsLoading}
          title="نواقص المخزون"
          value={stats ? formatNumber(stats.belowMinCount) : '—'}
          icon={<TrendingDown className="h-4 w-4" />}
          sub={stats ? (stats.belowMinCount ? 'أصناف دون الحد الأدنى' : 'المخزون ضمن الحدود') : 'البيانات غير متاحة'}
          variant={belowMinVariant}
          href="/reports?tab=below-min"
        />
        <KpiCard
          loading={statsLoading}
          title="نفدت من المخزون"
          value={stats ? formatNumber(stats.zeroStockCount) : '—'}
          icon={<BoxSelect className="h-4 w-4" />}
          sub={stats ? (stats.zeroStockCount ? 'أصناف بكمية صفر' : 'لا توجد أصناف نافدة') : 'البيانات غير متاحة'}
          variant={zeroStockVariant}
          href="/items"
        />
        <KpiCard
          loading={statsLoading}
          title={`عمليات ${monthName}`}
           value={stats ? formatNumber(Number(stats.monthlyIn ?? 0) + Number(stats.monthlyOut ?? 0)) : '—'}
          icon={<ArrowRightLeft className="h-4 w-4" />}
           sub={stats ? (() => {
             const curr = Number(stats.monthlyIn ?? 0) + Number(stats.monthlyOut ?? 0);
             const prev = Number(stats.prevMonthIn ?? 0) + Number(stats.prevMonthOut ?? 0);
            const diff = curr - prev;
            const pct = prev > 0 ? Math.round(Math.abs(diff) / prev * 100) : null;
            return (
              <span className="flex flex-col gap-0.5">
                <span className="flex gap-2">
                    <span className="text-emerald-600">↓ {formatNumber(stats.monthlyIn)} إدخال</span>
                    <span className="text-red-500">↑ {formatNumber(stats.monthlyOut)} إخراج</span>
                </span>
                {pct !== null && (
                  <span className={diff >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                    {diff >= 0 ? '▲' : '▼'} {pct}% مقارنةً بالشهر الماضي
                  </span>
                )}
              </span>
            );
          })() : '—'}
          variant="info"
          href="/transactions"
        />
      </div>

      {/* ── KPI Row 2: Alerts ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          loading={statsLoading}
          title="قرب انتهاء الصلاحية"
          value={stats ? formatNumber(stats.nearExpiryCount) : '—'}
          icon={<Clock className="h-4 w-4" />}
          sub={stats ? `خلال ${formatDays(stats.expiryAlertDays)} القادمة` : 'البيانات غير متاحة'}
          variant={nearExpiryVariant}
           href="/reports?tab=near-expiry"
        />
        <KpiCard
          loading={statsLoading}
          title="منتهية الصلاحية"
          value={stats ? formatNumber(stats.expiredCount) : '—'}
          icon={<ShieldAlert className="h-4 w-4" />}
          sub={stats ? (stats.expiredCount ? 'تحتاج إزالة فورية' : 'لا يوجد منتهي الصلاحية') : 'البيانات غير متاحة'}
          variant={expiredVariant}
          href="/reports?tab=expiry"
        />
        <KpiCard
          loading={statsLoading}
          title="إجمالي التجهيزات"
          value={stats ? formatNumber(stats.totalEquipment) : '—'}
          icon={<Stethoscope className="h-4 w-4" />}
          sub={stats ? (stats.totalEquipment ? 'جهاز ومعدة مسجّلة' : 'لا توجد تجهيزات مسجّلة') : 'البيانات غير متاحة'}
          href="/equipment"
        />
        <KpiCard
          loading={statsLoading}
          title="تجهيزات تحتاج انتباهاً"
          value={stats ? formatNumber(stats.equipmentAlertCount) : '—'}
          icon={<Wrench className="h-4 w-4" />}
          sub={stats ? 'صيانة / فحص / معطلة' : 'البيانات غير متاحة'}
          variant={equipAlertVariant}
          href="/equipment"
        />
        <KpiCard
          loading={statsLoading}
          title="مواد راكدة لأكثر من 7 أشهر"
          value={stats ? formatNumber(stats.stagnantItemsCount) : '—'}
          icon={<Archive className="h-4 w-4" />}
          sub={stats ? (stats.stagnantItemsCount ? 'رصيد لم يسجل حركة حديثة' : 'لا توجد مواد راكدة') : 'البيانات غير متاحة'}
          variant={stats?.stagnantItemsCount ? 'warning' : 'default'}
          href="/reports?tab=stagnant"
        />
      </div>

      {/* ── Recent transactions + Pie chart ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentTransactionsTable
            transactions={stats?.recentTransactions ?? []}
            loading={statsLoading}
            error={statsError}
            onRetry={() => void refetchStats()}
          />
        </div>

        {/* Pie chart: stock by category (quantity) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">توزيع المخزون بالكمية</CardTitle>
            <p className="text-xs text-muted-foreground">إجمالي الوحدات لكل تصنيف</p>
          </CardHeader>
          <CardContent>
            {chartsError ? (
              <DashboardSectionError section="توزيع المخزون" onRetry={() => void refetchCharts()} />
            ) : chartsLoading ? (
              <div className="h-60 flex items-center justify-center">
                <div className="h-32 w-32 rounded-full border-4 border-muted animate-pulse" />
              </div>
            ) : !charts?.stockByCategory?.length ? (
              <div className="h-60 flex items-center justify-center text-sm text-muted-foreground text-center">
                <div>
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  لا توجد بيانات بعد
                </div>
              </div>
            ) : (
              <>
                <div className="min-w-0 overflow-x-auto">
                  <ResponsiveContainer width="100%" height={240} aria-label="مخطط دائري يوضح توزيع المخزون حسب التصنيف">
                    <PieChart>
                      <Pie
                        data={charts.stockByCategory}
                        cx="50%"
                        cy="42%"
                        outerRadius={75}
                        innerRadius={30}
                        dataKey="totalStock"
                        nameKey="category"
                        paddingAngle={2}
                      >
                        {charts.stockByCategory.map((_: unknown, i: number) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={(props: TooltipProps<number, string>) => (
                          <ChartTooltip
                            {...props}
                            itemFormatter={(v, name, entry) => [
                              `${formatUnit(v)} (${formatNumber((entry as { payload?: { itemCount?: number } }).payload?.itemCount)} صنف)`,
                              name,
                            ]}
                          />
                        )}
                      />
                      <Legend
                        verticalAlign="bottom"
                        iconSize={8}
                        wrapperStyle={{ paddingTop: '12px', fontSize: '11px' }}
                        formatter={(value) => (
                          <span className="text-foreground">{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ChartDataTable label="توزيع المخزون حسب التصنيف">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">التصنيف</th>
                      <th scope="col" className="px-3 py-2">الوحدات</th>
                      <th scope="col" className="px-3 py-2">الأصناف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {charts.stockByCategory.map((row) => (
                      <tr key={row.category}>
                        <th scope="row" className="px-3 py-2 font-medium">{row.category}</th>
                        <td className="px-3 py-2 tabular-nums">{formatUnit(row.totalStock)}</td>
                        <td className="px-3 py-2 tabular-nums">{formatNumber(row.itemCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </ChartDataTable>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 30-day movement area chart ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">حركة المستودع — آخر 30 يوماً</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">الكميات الداخلة والخارجة يومياً</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />
                إدخال
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-red-500 inline-block rounded" />
                إخراج
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartsError ? (
            <DashboardSectionError section="حركة المستودع اليومية" onRetry={() => void refetchCharts()} />
          ) : chartsLoading ? (
            <div className="h-52 animate-pulse bg-muted/30 rounded-lg" />
          ) : !charts?.dailyMovement?.some(d => d.inQty > 0 || d.outQty > 0) ? (
            // generate_series always returns 30 rows; check actual movement instead of length
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center">
                <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-20" />
                لا توجد حركات في آخر 30 يوماً
              </div>
            </div>
          ) : (
            <>
              <div className="min-w-0 overflow-x-auto">
                <ResponsiveContainer width="100%" height={200} aria-label="مخطط مساحي يوضح حركة المستودع اليومية خلال آخر 30 يوماً">
                  <AreaChart data={charts.dailyMovement} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={(props: TooltipProps<number, string>) => (
                        <ChartTooltip
                          {...props}
                           itemFormatter={(v, key, entry) => [
                             formatUnit(v),
                             entry.dataKey === 'inQty' ? 'إدخال' : entry.dataKey === 'outQty' ? 'إخراج' : key,
                           ]}
                        />
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="inQty"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#colorIn)"
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="outQty"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#colorOut)"
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <ChartDataTable label="حركة المستودع اليومية">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">اليوم</th>
                    <th scope="col" className="px-3 py-2">إدخال</th>
                    <th scope="col" className="px-3 py-2">إخراج</th>
                    <th scope="col" className="px-3 py-2">العمليات</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {charts.dailyMovement.map((row) => (
                    <tr key={row.day}>
                      <th scope="row" className="px-3 py-2 font-medium">{row.day}</th>
                      <td className="px-3 py-2 tabular-nums">{formatUnit(row.inQty)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatUnit(row.outQty)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNumber(row.txCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </ChartDataTable>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Top items grouped bar chart ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">أعلى الأصناف نشاطاً — آخر 30 يوماً</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">مقارنة الكميات الداخلة والخارجة لكل صنف <span className="text-muted-foreground/60">(المواد فقط — التجهيزات مستثناة)</span></p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-emerald-500 inline-block rounded-sm" />
                إدخال
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 bg-red-400 inline-block rounded-sm" />
                إخراج
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chartsError ? (
            <DashboardSectionError section="الأصناف الأكثر نشاطاً" onRetry={() => void refetchCharts()} />
          ) : chartsLoading ? (
            <div className="h-64 animate-pulse bg-muted/30 rounded-lg" />
          ) : !charts?.topItems?.length ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              <div className="text-center">
                <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-20" />
                لا توجد بيانات حركة في آخر 30 يوماً
              </div>
            </div>
          ) : (
            <>
              <div className="min-w-0 overflow-x-auto">
                <ResponsiveContainer width="100%" height={Math.max(320, charts.topItems.length * 52)} aria-label="مخطط أعمدة أفقي يوضح أعلى الأصناف نشاطاً خلال آخر 30 يوماً">
                  <BarChart
                    data={charts.topItems}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                    barCategoryGap="25%"
                    barGap={2}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                      stroke="transparent"
                      tickLine={false}
                    />
                    <Tooltip
                      content={(props: TooltipProps<number, string>) => (
                        <ChartTooltip
                          {...props}
                           itemFormatter={(v, key, entry) => [
                             formatUnit(v),
                             entry.dataKey === 'inQty' ? 'إدخال' : entry.dataKey === 'outQty' ? 'إخراج' : key,
                           ]}
                        />
                      )}
                    />
                    <Bar dataKey="inQty" fill="#10b981" radius={[0, 3, 3, 0]} name="إدخال" />
                    <Bar dataKey="outQty" fill="#f87171" radius={[0, 3, 3, 0]} name="إخراج" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartDataTable label="الأصناف الأكثر نشاطاً">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">الصنف</th>
                    <th scope="col" className="px-3 py-2">إدخال</th>
                    <th scope="col" className="px-3 py-2">إخراج</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {charts.topItems.map((row) => (
                    <tr key={row.name}>
                      <th scope="row" className="px-3 py-2 font-medium">{row.name}</th>
                      <td className="px-3 py-2 tabular-nums">{formatUnit(row.inQty)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatUnit(row.outQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </ChartDataTable>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
