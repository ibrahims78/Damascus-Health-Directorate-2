import { lazy, Suspense, useEffect, type ElementType } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/theme-provider';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { storeCsrfToken } from '@/lib/csrf-client';
import {
  AccessDeniedState,
  ConnectionErrorState,
  LoadingState,
} from '@/components/app-state';
import { SessionExpiryDialog } from '@/components/session-expiry-dialog';

// Layout
import { Shell } from '@/components/layout/shell';

// Pages
// Keep the authenticated shell small and load each page only when its route is
// opened. This matters on field devices where the first screen is often loaded
// over a slow or intermittent connection.
const NotFound = lazy(() => import('@/pages/not-found'));
const LoginPage = lazy(() => import('@/pages/login').then(({ LoginPage }) => ({ default: LoginPage })));
const SetupPage = lazy(() => import('@/pages/setup').then(({ SetupPage }) => ({ default: SetupPage })));
const ChangePasswordPage = lazy(() => import('@/pages/change-password').then(({ ChangePasswordPage }) => ({ default: ChangePasswordPage })));
const DashboardPage = lazy(() => import('@/pages/dashboard').then(({ DashboardPage }) => ({ default: DashboardPage })));
const ItemsPage = lazy(() => import('@/pages/items').then(({ ItemsPage }) => ({ default: ItemsPage })));
const EquipmentPage = lazy(() => import('@/pages/equipment').then(({ EquipmentPage }) => ({ default: EquipmentPage })));
const CatalogPage = lazy(() => import('@/pages/catalog').then(({ CatalogPage }) => ({ default: CatalogPage })));
const InventoryPage = lazy(() => import('@/pages/inventory').then(({ InventoryPage }) => ({ default: InventoryPage })));
const TransfersPage = lazy(() => import('@/pages/transfers').then(({ TransfersPage }) => ({ default: TransfersPage })));
const TransferPrintPage = lazy(() => import('@/pages/transfer-print').then(({ TransferPrintPage }) => ({ default: TransferPrintPage })));
const TransactionsPage = lazy(() => import('@/pages/transactions').then(({ TransactionsPage }) => ({ default: TransactionsPage })));
const ReportsPage = lazy(() => import('@/pages/reports').then(({ ReportsPage }) => ({ default: ReportsPage })));
const UsersPage = lazy(() => import('@/pages/users').then(({ UsersPage }) => ({ default: UsersPage })));
const SettingsPage = lazy(() => import('@/pages/settings').then(({ SettingsPage }) => ({ default: SettingsPage })));
const AuditPage = lazy(() => import('@/pages/audit').then(({ AuditPage }) => ({ default: AuditPage })));
const SyncPage = lazy(() => import('@/pages/sync').then(({ SyncPage }) => ({ default: SyncPage })));
const HelpPage = lazy(() => import('@/pages/help').then(({ HelpPage }) => ({ default: HelpPage })));
const PrintTransactionPage = lazy(() => import('@/pages/print-transaction').then(({ PrintTransactionPage }) => ({ default: PrintTransactionPage })));
const ItemDetailsPage = lazy(() => import('@/pages/item-details').then(({ ItemDetailsPage }) => ({ default: ItemDetailsPage })));
const CustodyDetailsPage = lazy(() => import('@/pages/custody-details').then(({ CustodyDetailsPage }) => ({ default: CustodyDetailsPage })));
const CustodyOutForm = lazy(() => import('@/pages/inventory-lifecycle-forms').then(({ CustodyOutForm }) => ({ default: CustodyOutForm })));
const CustodyReturnForm = lazy(() => import('@/pages/inventory-lifecycle-forms').then(({ CustodyReturnForm }) => ({ default: CustodyReturnForm })));
const DamageForm = lazy(() => import('@/pages/inventory-lifecycle-forms').then(({ DamageForm }) => ({ default: DamageForm })));
const CentralReturnForm = lazy(() => import('@/pages/inventory-lifecycle-forms').then(({ CentralReturnForm }) => ({ default: CentralReturnForm })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

function ProtectedRoute({
  component: Component,
  adminOnly = false,
  roles,
}: {
  component: ElementType;
  adminOnly?: boolean;
  /** When set, only these roles may open the page. */
  roles?: string[];
}) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading, isError, error, refetch } = useGetCurrentUser();
  const status = (error as unknown as { response?: { status?: number } } | null | undefined)
    ?.response?.status;
  // An initial unauthenticated request should reach the login/setup flow.
  // The dialog is reserved for a session that had a cached user and then expired.
  const isSessionExpired = isError && (status === 401 || status === 403) && Boolean(user);

  // Keep the CSRF token available to the fetch wrapper (issued at login and
  // refreshed on every /me round trip).
  useEffect(() => {
    storeCsrfToken((user as { csrfToken?: string } | undefined)?.csrfToken ?? null);
  }, [user]);

  // Must be called unconditionally before any early returns
  useEffect(() => {
    if (!isLoading && !isSessionExpired && isError && location !== '/login') {
      setLocation('/login');
    }
    const current = user as { mustChangePassword?: boolean } | undefined;
    if (!isLoading && user && current?.mustChangePassword && location !== '/change-password') {
      setLocation('/change-password');
    }
  }, [isLoading, isError, isSessionExpired, user, location, setLocation]);

  if (isLoading) {
    return <LoadingState label="جاري التحقق من جلسة الدخول..." />;
  }

  if (isSessionExpired) {
    return (
      <SessionExpiryDialog
        open
        onContinue={() => {
          queryClient.clear();
          storeCsrfToken(null);
          setLocation('/login');
        }}
      />
    );
  }

  if (isError) {
    return (
      <ConnectionErrorState
        onRetry={() => {
          void refetch();
        }}
        title="تعذر الاتصال بالخادم الداخلي"
        description="لم يتمكن التطبيق من الوصول إلى قاعدة البيانات المحلية. تحقق من الاتصال ثم حاول مرة أخرى."
      />
    );
  }

  if (!user) return null;

  if (adminOnly && user.role !== 'admin') {
    return <AccessDeniedState onBack={() => setLocation('/')} />;
  }

  // Operational screens (custody, damage, returns) are limited to the roles
  // that can actually execute them - a viewer must never reach the form.
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return <AccessDeniedState onBack={() => setLocation('/')} />;
  }

  return (
    <Shell>
      <Component />
    </Shell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/setup" component={SetupPage} />
      <Route path="/login" component={LoginPage} />

      {/* Protected Routes */}
      <Route path="/"><ProtectedRoute component={DashboardPage} /></Route>
      <Route path="/items"><ProtectedRoute component={ItemsPage} /></Route>
      <Route path="/items/new"><ProtectedRoute component={ItemsPage} adminOnly /></Route>
      <Route path="/items/:id/edit"><ProtectedRoute component={ItemsPage} adminOnly /></Route>
      <Route path="/items/:id/adjust"><ProtectedRoute component={ItemsPage} /></Route>
      <Route path="/items/:id"><ProtectedRoute component={ItemDetailsPage} /></Route>

      <Route path="/equipment"><ProtectedRoute component={EquipmentPage} /></Route>
      <Route path="/equipment/new"><ProtectedRoute component={EquipmentPage} adminOnly /></Route>
      <Route path="/equipment/:id/edit"><ProtectedRoute component={EquipmentPage} adminOnly /></Route>
      <Route path="/equipment/:id/adjust"><ProtectedRoute component={EquipmentPage} /></Route>
      <Route path="/equipment/:id"><ProtectedRoute component={EquipmentPage} /></Route>
      <Route path="/catalog"><ProtectedRoute component={CatalogPage} /></Route>
      <Route path="/inventory"><ProtectedRoute component={InventoryPage} /></Route>
      <Route path="/transfers"><ProtectedRoute component={TransfersPage} /></Route>
      <Route path="/transfers/:id/print"><ProtectedRoute component={TransferPrintPage} /></Route>
      <Route path="/custodies/:id"><ProtectedRoute component={CustodyDetailsPage} /></Route>

      <Route path="/transactions"><ProtectedRoute component={TransactionsPage} /></Route>
      <Route path="/transactions/in/new"><ProtectedRoute component={TransactionsPage} /></Route>
      <Route path="/transactions/out/new"><ProtectedRoute component={TransactionsPage} /></Route>
      <Route path="/custody/out/new"><ProtectedRoute component={CustodyOutForm} roles={["admin","warehouse_manager"]} /></Route>
      <Route path="/custody/return/new"><ProtectedRoute component={CustodyReturnForm} roles={["admin","warehouse_manager"]} /></Route>
      <Route path="/damage/new"><ProtectedRoute component={DamageForm} roles={["admin","warehouse_manager"]} /></Route>
      <Route path="/central-return/new"><ProtectedRoute component={CentralReturnForm} roles={["admin","warehouse_manager"]} /></Route>

      <Route path="/reports"><ProtectedRoute component={ReportsPage} /></Route>
      <Route path="/help"><ProtectedRoute component={HelpPage} /></Route>

      {/* Admin-only routes */}
      <Route path="/users"><ProtectedRoute component={UsersPage} adminOnly /></Route>
      <Route path="/audit"><ProtectedRoute component={AuditPage} adminOnly /></Route>
      <Route path="/sync"><ProtectedRoute component={SyncPage} adminOnly /></Route>
      <Route path="/change-password"><ProtectedRoute component={ChangePasswordPage} /></Route>
      <Route path="/settings"><ProtectedRoute component={SettingsPage} adminOnly /></Route>

      {/* Print Route (No shell) */}
      <Route path="/print/:id"><ProtectedRoute component={PrintTransactionPage} /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="damascus-ems-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Suspense fallback={<LoadingState label="جاري تحميل الصفحة..." />}>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
          </Suspense>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
