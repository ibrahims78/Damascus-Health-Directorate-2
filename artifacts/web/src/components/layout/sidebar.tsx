import { Link, useLocation } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import {
  LayoutDashboard,
  Package,
  Stethoscope,
  BookOpen,
  Boxes,
  ArrowRightLeft,
  Truck,
  FileText,
  Users,
  Settings,
  ShieldCheck,
  Menu,
  X,
  ChevronsRight,
  ChevronsLeft,
  Code2,
  ArchiveRestore,
  FileWarning,
  RotateCcw,
  UserRoundCheck,
  Network,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import logoUrl from '@assets/damascus-health-directorate-mark.png';
import { useSidebar } from './sidebar-context';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "v4.0.3";
const DESIGNER_NAME = 'إبراهيم الصيداوي';
const DESIGNER_PHONE = '0933706403';

const navItems = [
  { href: '/',             label: 'لوحة التحكم',        icon: LayoutDashboard },
  { href: '/items',        label: 'المواد والمستهلكات',  icon: Package },
  { href: '/equipment',    label: 'التجهيزات الطبية',    icon: Stethoscope },
  { href: '/catalog', label: 'الكتالوج', icon: BookOpen },
  { href: '/inventory', label: 'مركز المخزون', icon: Boxes },
  { href: '/transfers', label: 'التحويلات', icon: Truck },
  { href: '/transactions', label: 'سجل العمليات',        icon: ArrowRightLeft },
  { href: '/reports',      label: 'التقارير',             icon: FileText },
];

const movementItems = [
  { href: '/custody/out/new',    label: 'تسليم عهدة شخصية', icon: UserRoundCheck },
  { href: '/custody/return/new', label: 'إعادة عهدة',       icon: RotateCcw },
  { href: '/damage/new',         label: 'تسجيل تلف',        icon: FileWarning },
  { href: '/central-return/new', label: 'مرتجع مركزي',      icon: ArchiveRestore },
];

const adminItems = [
  { href: '/users',    label: 'المستخدمين',  icon: Users },
  { href: '/audit',    label: 'سجل التدقيق', icon: ShieldCheck },
  { href: '/sync',     label: 'المزامنة والعقد', icon: Network },
  { href: '/settings', label: 'الإعدادات',   icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: user } = useGetCurrentUser();
  const { collapsed, toggle } = useSidebar();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const isRouteActive = (href: string) =>
    href === '/' ? location === '/' : location.startsWith(href);
  const movementActive = movementItems.some(item => isRouteActive(item.href));
  const adminActive = adminItems.some(item => isRouteActive(item.href));

  useEffect(() => {
    if (!isMobileOpen) return;

    const firstLink = sidebarRef.current?.querySelector<HTMLElement>(
      '[data-sidebar-first-link="true"]',
    );
    window.requestAnimationFrame(() => firstLink?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsMobileOpen(false);
      window.requestAnimationFrame(() => mobileToggleRef.current?.focus());
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen]);

  const closeMobileMenu = () => {
    setIsMobileOpen(false);
    window.requestAnimationFrame(() => mobileToggleRef.current?.focus());
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* Mobile Toggle */}
      <button
        ref={mobileToggleRef}
        className="md:hidden fixed bottom-4 right-4 z-50 p-3 bg-primary text-primary-foreground rounded-full shadow-lg print:hidden"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        type="button"
        aria-expanded={isMobileOpen}
        aria-controls="primary-navigation"
        aria-label={isMobileOpen ? 'إغلاق القائمة الجانبية' : 'فتح القائمة الجانبية'}
      >
        {isMobileOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
      </button>

      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm print:hidden"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        id="primary-navigation"
        aria-label="التنقل الرئيسي"
        className={cn(
          'fixed md:static inset-y-0 right-0 z-40 border-l bg-card flex flex-col',
          'transition-all duration-300 ease-in-out',
          collapsed ? 'w-[60px]' : 'w-64',
          isMobileOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0',
        )}
      >
        {/* Header: logo + title */}
        <div
          className={cn(
            'border-b flex items-center transition-all duration-300',
            collapsed ? 'p-3 justify-center' : 'p-5 gap-3',
          )}
        >
          <img
            src={logoUrl}
            alt="شعار مستودعات مديرية صحة دمشق"
            className={cn(
              'object-contain rounded-full border shadow-sm flex-shrink-0 transition-all duration-300',
              collapsed ? 'w-9 h-9' : 'w-12 h-12',
            )}
          />
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="font-bold text-sm text-foreground leading-snug">
                مستودعات مديرية صحة دمشق
              </h1>
            </div>
          )}
        </div>

        {/* Desktop collapse toggle */}
        <button
          onClick={toggle}
          type="button"
          className={cn(
            'hidden md:flex items-center justify-center h-7 w-7 rounded-md',
            'text-muted-foreground hover:text-foreground hover:bg-secondary',
            'transition-colors absolute -left-3.5 top-[68px] z-10',
            'bg-card border shadow-sm',
          )}
          title={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}
          aria-label={collapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}
          aria-expanded={!collapsed}
        >
          {collapsed
            ? <ChevronsLeft className="w-3.5 h-3.5" aria-hidden="true" />
            : <ChevronsRight className="w-3.5 h-3.5" aria-hidden="true" />
          }
        </button>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isRouteActive(item.href);

            const linkEl = (
              <Link
                href={item.href}
                aria-label={item.label}
                data-sidebar-first-link={item.href === navItems[0].href ? 'true' : undefined}
                className={cn(
                  'flex items-center rounded-md text-sm font-medium transition-colors',
                  collapsed
                    ? 'justify-center p-2.5'
                    : 'gap-3 px-3 py-2.5',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
                onClick={closeMobileMenu}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );

            return (
              <div key={item.href}>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                    <TooltipContent side="left" className="font-medium">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                ) : linkEl}
              </div>
            );
          })}

          {/* Secondary actions stay available, but do not compete with the
              daily navigation until the user needs them. */}
          <Collapsible
            open={collapsed || movementOpen || movementActive}
            onOpenChange={setMovementOpen}
            className="pt-2"
          >
            {collapsed ? (
              <div className="border-t mx-1 mb-2" />
            ) : (
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'w-full flex items-center justify-between rounded-md px-3 py-2 text-[11px] font-semibold',
                    'text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors',
                    movementActive && 'text-foreground bg-secondary/60',
                  )}
                  aria-label="فتح عمليات العهد والأحداث"
                >
                  <span className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4" />
                    عمليات العهد والأحداث
                  </span>
                  <ChevronDown className={cn('w-4 h-4 transition-transform', (movementOpen || movementActive) && 'rotate-180')} />
                </button>
              </CollapsibleTrigger>
            )}
            <CollapsibleContent className="space-y-0.5 pt-1">
              {movementItems.map(item => {
                const Icon = item.icon;
                const linkEl = (
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    className={cn(
                      'flex items-center rounded-md text-sm font-medium transition-colors',
                      collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
                      isRouteActive(item.href)
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )}
                    onClick={closeMobileMenu}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
                return collapsed ? (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                    <TooltipContent side="left" className="font-medium">{item.label}</TooltipContent>
                  </Tooltip>
                ) : <div key={item.href}>{linkEl}</div>;
              })}
            </CollapsibleContent>
          </Collapsible>

          {user?.role === 'admin' && (
            <Collapsible
              open={collapsed || adminOpen || adminActive}
              onOpenChange={setAdminOpen}
              className="pt-1"
            >
              {collapsed ? (
                <div className="border-t mx-1 mb-2" />
              ) : (
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'w-full flex items-center justify-between rounded-md px-3 py-2 text-[11px] font-semibold',
                      'text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors',
                      adminActive && 'text-foreground bg-secondary/60',
                    )}
                    aria-label="فتح إدارة النظام"
                  >
                    <span className="flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      إدارة النظام
                    </span>
                    <ChevronDown className={cn('w-4 h-4 transition-transform', (adminOpen || adminActive) && 'rotate-180')} />
                  </button>
                </CollapsibleTrigger>
              )}
              <CollapsibleContent className="space-y-0.5 pt-1">
                {adminItems.map(item => {
                  const Icon = item.icon;
                  const linkEl = (
                    <Link
                      href={item.href}
                      aria-label={item.label}
                      className={cn(
                        'flex items-center rounded-md text-sm font-medium transition-colors',
                        collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
                        isRouteActive(item.href)
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )}
                      onClick={closeMobileMenu}
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                  return collapsed ? (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                      <TooltipContent side="left" className="font-medium">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : <div key={item.href}>{linkEl}</div>;
                })}
              </CollapsibleContent>
            </Collapsible>
          )}
        </nav>

        {/* Footer: version + designer signature */}
        <div
          className={cn(
            'border-t mt-auto transition-all duration-300',
            collapsed ? 'p-2' : 'p-3',
          )}
        >
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center">
                  <span className="text-[9px] font-mono text-muted-foreground/50 select-none">
                    {APP_VERSION}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">
                <div className="text-center leading-relaxed">
                  <div>{APP_VERSION}</div>
                  <div className="opacity-80">تصميم: {DESIGNER_NAME}</div>
                  <div className="opacity-60 font-mono">{DESIGNER_PHONE}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-muted-foreground/50 select-none tracking-wide">
                  {APP_VERSION}
                </span>
                <span className="text-[10px] text-muted-foreground/40 select-none">
                  نظام إدارة المستودعات
                </span>
              </div>
              <div className="flex items-center gap-1.5 pt-0.5 border-t border-dashed border-border/40">
                <Code2 className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground/50 leading-tight truncate">
                    تصميم: {DESIGNER_NAME}
                  </div>
                  <a
                    href={`tel:${DESIGNER_PHONE}`}
                    className="text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors leading-tight block"
                    dir="ltr"
                  >
                    {DESIGNER_PHONE}
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
