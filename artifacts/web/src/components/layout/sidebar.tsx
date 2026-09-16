import { Link, useLocation } from 'wouter';
import { useGetCurrentUser } from '@workspace/api-client-react';
import {LayoutDashboard,
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
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  ClipboardCheck,
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

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "v4.8.0";
const DESIGNER_NAME = 'Ø¥Ø¨Ø±Ø§Ù‡ÙŠÙ… Ø§Ù„ØµÙŠØ¯Ø§ÙˆÙŠ';
const DESIGNER_PHONE = '0933706403';

const navItems = [
  { href: '/',               label: 'Ù„ÙˆØ­Ø© Ø§Ù„Ù…Ø¹Ù„ÙˆÙ…Ø§Øª',  icon: LayoutDashboard },
  { href: '/inventory',      label: 'Ù…Ø±ÙƒØ² Ø§Ù„Ù…Ø®Ø²ÙˆÙ†',     icon: Boxes },
];

type NavGroup = {
  id: string;
  title: string;
  icon: typeof LayoutDashboard;
  roles?: string[];
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
};

/**
 * Sidebar information architecture: the sections are grouped by the task the
 * user is trying to accomplish, and each group declares which roles may see it
 * (an entry that a user cannot use must not be shown at all).
 */
const navGroups: NavGroup[] = [
  {
    id: 'stock',
    title: 'Ø§Ù„Ù…Ø®Ø²ÙˆÙ† ÙˆØ§Ù„ØªØ­ÙˆÙŠÙ„Ø§Øª',
    icon: Package,
    items: [
      { href: '/items',        label: 'Ø§Ù„Ù…ÙˆØ§Ø¯',         icon: Package },
      { href: '/equipment',    label: 'Ø§Ù„ØªØ¬Ù‡ÙŠØ²Ø§Øª',      icon: Stethoscope },
      { href: '/transfers',    label: 'Ø§Ù„ØªØ­ÙˆÙŠÙ„Ø§Øª',      icon: Truck },
      { href: '/transactions', label: 'Ø³Ø¬Ù„ Ø§Ù„Ø­Ø±ÙƒØ§Øª',    icon: ArrowRightLeft },
    ],
  },
  {
    id: 'ops',
    title: 'Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª Ø§Ù„ÙŠÙˆÙ…ÙŠØ©',
    icon: ClipboardList,
    roles: ['admin', 'warehouse_manager'],
    items: [
      { href: '/transactions/in/new',   label: 'Ø¥Ø¯Ø®Ø§Ù„ Ù…ÙˆØ§Ø¯',    icon: ArrowDownToLine },
      { href: '/transactions/out/new',  label: 'Ø¥Ø®Ø±Ø§Ø¬ Ù…ÙˆØ§Ø¯',    icon: ArrowUpFromLine },
      { href: '/custody/out/new',       label: 'ØªØ³Ù„ÙŠÙ… Ø¹Ù‡Ø¯Ø©',    icon: UserRoundCheck },
      { href: '/custody/return/new',    label: 'Ø¥Ø¹Ø§Ø¯Ø© Ø¹Ù‡Ø¯Ø©',    icon: RotateCcw },
      { href: '/damage/new',            label: 'ØªØ³Ø¬ÙŠÙ„ ØªÙ„Ù',     icon: FileWarning },
      { href: '/central-return/new',    label: 'Ù…Ø±ØªØ¬Ø¹ Ù…Ø±ÙƒØ²ÙŠ',   icon: ArchiveRestore },
    ],
  },
  {
    id: 'counts',
    title: 'Ø§Ù„Ø¬Ø±Ø¯ Ø§Ù„Ø¯ÙˆØ±ÙŠ',
    icon: ClipboardCheck,
    roles: ['admin', 'warehouse_manager'],
    items: [
      { href: '/counts', label: 'Ø§Ù„Ø¬Ø±Ø¯ Ø§Ù„Ø¯ÙˆØ±ÙŠ', icon: ClipboardCheck },
    ],
  },
  {
    id: 'catalog',
    title: 'Ø§Ù„ÙƒØªØ§Ù„ÙˆØ¬ ÙˆØ§Ù„Ø¨ÙŠØ§Ù†Ø§Øª',
    icon: BookOpen,
    roles: ['admin', 'warehouse_manager'],
    items: [
      { href: '/catalog', label: 'Ø§Ù„ÙƒØªØ§Ù„ÙˆØ¬ ÙˆØ§Ù„ÙˆØ­Ø¯Ø§Øª', icon: BookOpen },
    ],
  },
  {
    id: 'reports',
    title: 'Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ±',
    icon: FileText,
    items: [
      { href: '/reports', label: 'Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ± Ø§Ù„ØªÙØµÙŠÙ„ÙŠØ©', icon: FileText },
    ],
  },
  {
    id: 'admin',
    title: 'Ø§Ù„Ø¥Ø¯Ø§Ø±Ø©',
    icon: Settings,
    roles: ['admin'],
    items: [
      { href: '/users',    label: 'Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙˆÙ†',    icon: Users },
      { href: '/audit',    label: 'Ø³Ø¬Ù„ Ø§Ù„ØªØ¯Ù‚ÙŠÙ‚',   icon: ShieldCheck },
      { href: '/sync',     label: 'Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© ÙˆØ§Ù„Ø±Ø¨Ø·', icon: Network },
      { href: '/settings', label: 'Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª',      icon: Settings },
    ],
  },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: user } = useGetCurrentUser();
  const { collapsed, toggle } = useSidebar();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const isRouteActive = (href: string) =>
    href === '/' ? location === '/' : location.startsWith(href);
  const groupActive = (items: { href: string }[]) => items.some((item) => isRouteActive(item.href));

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
        aria-label={isMobileOpen ? 'Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠØ©' : 'ÙØªØ­ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠØ©'}
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
        aria-label="Ø§Ù„ØªÙ†Ù‚Ù„ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠ"
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
            alt="Ø´Ø¹Ø§Ø± Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ù…Ø¯ÙŠØ±ÙŠØ© ØµØ­Ø© Ø¯Ù…Ø´Ù‚"
            className={cn(
              'object-contain rounded-full border shadow-sm flex-shrink-0 transition-all duration-300',
              collapsed ? 'w-9 h-9' : 'w-12 h-12',
            )}
          />
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="font-bold text-sm text-foreground leading-snug">
                Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª Ù…Ø¯ÙŠØ±ÙŠØ© ØµØ­Ø© Ø¯Ù…Ø´Ù‚
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
          title={collapsed ? 'ØªÙˆØ³ÙŠØ¹ Ø§Ù„Ø´Ø±ÙŠØ· Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠ' : 'Ø·ÙŠ Ø§Ù„Ø´Ø±ÙŠØ· Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠ'}
          aria-label={collapsed ? 'ØªÙˆØ³ÙŠØ¹ Ø§Ù„Ø´Ø±ÙŠØ· Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠ' : 'Ø·ÙŠ Ø§Ù„Ø´Ø±ÙŠØ· Ø§Ù„Ø¬Ø§Ù†Ø¨ÙŠ'}
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
                className={cn(
                  'flex items-center rounded-md text-sm font-medium transition-colors',
                  collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2',
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

            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                <TooltipContent side="left" className="font-medium">{item.label}</TooltipContent>
              </Tooltip>
            ) : <div key={item.href}>{linkEl}</div>;
          })}

          {navGroups.map((group) => {
            if (group.roles && !group.roles.includes(user?.role ?? '')) return null;
            const Icon = group.icon;
            const active = groupActive(group.items);
            const open = collapsed || openGroups[group.id] === true || active;

            return (
              <Collapsible
                key={group.id}
                open={open}
                onOpenChange={(value) => setOpenGroups((prev) => ({ ...prev, [group.id]: value }))}
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
                        active && 'text-foreground bg-secondary/60',
                      )}
                      aria-label={group.title}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        {group.title}
                      </span>
                      <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
                    </button>
                  </CollapsibleTrigger>
                )}
                <CollapsibleContent className="space-y-0.5 pt-1">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
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
                        <ItemIcon className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
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
            );
          })}
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
                  <div className="opacity-80">ØªØµÙ…ÙŠÙ…: {DESIGNER_NAME}</div>
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
                  Ù†Ø¸Ø§Ù… Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ø³ØªÙˆØ¯Ø¹Ø§Øª
                </span>
              </div>
              <div className="flex items-center gap-1.5 pt-0.5 border-t border-dashed border-border/40">
                <Code2 className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground/50 leading-tight truncate">
                    ØªØµÙ…ÙŠÙ…: {DESIGNER_NAME}
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

