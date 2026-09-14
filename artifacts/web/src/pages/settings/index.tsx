import { useEffect, useMemo, useState } from 'react';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  User as UserIcon,
  KeyRound,
  Activity,
  Building2,
  Tag,
  UsersRound,
  ListChecks,
  Ruler,
  Wrench,
  DatabaseBackup,
  FileSpreadsheet,
  ShieldCheck,
} from 'lucide-react';
import { ProfileTab } from './profile';
import { PasswordTab } from './password';
import { ActivityTab } from './activity';
import { OrgTab } from './org';
import { UnitsTab } from './units';
import { TechnicalConditionsTab } from './technical';
import { BackupTab } from './backup';
import { CategoriesTab, RecipientsTab, ExitReasonsTab } from './catalog';
import { ImportTab, ImportEquipmentTab } from './import';

export function SettingsPage() {
  const { data: currentUser } = useGetCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const [location, setLocation] = useLocation();

  const groups = useMemo(() => [
    {
      label: 'الحساب',
      tabs: [
        ['profile', 'الملف الشخصي', UserIcon],
        ['password', 'كلمة المرور', KeyRound],
        ['activity', 'سجل نشاطي', Activity],
      ] as const,
    },
    {
      label: 'المؤسسة والمخزون',
      tabs: [
        ['org', 'إعدادات المستودع', Building2],
        ['units', 'وحدات القياس', Ruler],
        ['technical-conditions', 'الحالات الفنية', Wrench],
      ] as const,
    },
    {
      label: 'الكتالوج',
      tabs: [
        ['categories', 'التصنيفات', Tag],
        ['recipients', 'الجهات المستلمة', UsersRound],
        ['exit-reasons', 'أسباب الإخراج', ListChecks],
      ] as const,
    },
    {
      label: 'البيانات',
      tabs: [
        ['import', 'استيراد مواد', FileSpreadsheet],
        ['import-equipment', 'استيراد تجهيزات', FileSpreadsheet],
        ['backup', 'النسخ والاستعادة', DatabaseBackup],
      ] as const,
    },
  ], []);
  const allowedTabs = useMemo(
    () => new Set<string>(groups.flatMap((group) => group.tabs.map(([value]) => value))),
    [groups],
  );
  const queryTab = new URLSearchParams(location.split('?')[1] ?? '').get('tab');
  const [activeTab, setActiveTab] = useState(
    queryTab && allowedTabs.has(queryTab) && (isAdmin || ['profile', 'password', 'activity'].includes(queryTab))
      ? queryTab
      : 'profile',
  );

  useEffect(() => {
    const nextTab = queryTab && allowedTabs.has(queryTab) && (isAdmin || ['profile', 'password', 'activity'].includes(queryTab))
      ? queryTab
      : 'profile';
    setActiveTab(nextTab);
  }, [allowedTabs, isAdmin, queryTab]);

  const tabDescriptions: Record<string, string> = {
    profile: 'حدّث الاسم الظاهر والبيانات التي تظهر في المستندات.',
    password: 'غيّر كلمة المرور من خلال خطوة آمنة دون كشفها في الرسائل.',
    activity: 'راجع نشاط حسابك مع البحث والتصفية عند الحاجة.',
    org: 'اضبط هوية المؤسسة والتنبيهات التي تؤثر على العرض والتقارير.',
    units: 'أدر وحدات القياس المستخدمة عند إنشاء المواد.',
    'technical-conditions': 'عرّف الحالات الفنية التي تظهر في دورة حياة التجهيز.',
    categories: 'نظّم المواد والتجهيزات ضمن تصنيفات واضحة قابلة للبحث.',
    recipients: 'أدر الجهات المستلمة التي تظهر في سندات الإخراج.',
    'exit-reasons': 'وحّد أسباب الإخراج حتى تكون التقارير قابلة للمقارنة.',
    import: 'استورد المواد عبر قالب، معاينة، وملخص أخطاء قابل للتصرف.',
    'import-equipment': 'استورد التجهيزات مع التحقق من التسلسلي والحالة والكمية.',
    backup: 'أنشئ نسخة مشفرة أو افحص واستعد حزمة مع نقطة تراجع.',
  };
  const tabLabels: Record<string, string> = {
    profile: 'الملف الشخصي',
    password: 'كلمة المرور',
    activity: 'سجل نشاطي',
    org: 'إعدادات المستودع',
    units: 'وحدات القياس',
    'technical-conditions': 'الحالات الفنية',
    categories: 'التصنيفات',
    recipients: 'الجهات المستلمة',
    'exit-reasons': 'أسباب الإخراج',
    import: 'استيراد مواد',
    'import-equipment': 'استيراد تجهيزات',
    backup: 'النسخ والاستعادة',
  };

  const selectTab = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', value);
    setLocation(`/settings?${params.toString()}`);
  };

  return (
    <div className="space-y-6 max-w-5xl" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">الإعدادات</h1>
        <p className="text-sm text-muted-foreground mt-1">
          مركز موحد للحساب والأمان والمؤسسة والكتالوج والبيانات.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={selectTab} dir="rtl">
        <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 xl:grid-cols-4">
          {groups.map((group) => {
            const visibleTabs = group.tabs.filter(([value]) => isAdmin || ['profile', 'password', 'activity'].includes(value));
            if (!visibleTabs.length) return null;
            return (
              <div key={group.label} className="min-w-0">
                <p className="mb-2 px-2 text-xs font-bold text-muted-foreground">{group.label}</p>
                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                  {visibleTabs.map(([value, label, Icon]) => (
                    <TabsTrigger key={value} value={value} className="min-h-10 justify-start gap-2 px-2 text-xs sm:text-sm">
                      <Icon className="h-4 w-4 shrink-0" />{label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">{tabLabels[activeTab]}</p>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">{tabDescriptions[activeTab]}</p>
          </div>
        </div>

        <TabsContent value="profile">
          <ProfileTab user={currentUser} />
        </TabsContent>

        <TabsContent value="password">
          <PasswordTab />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTab />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="org">
            <OrgTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="categories">
            <CategoriesTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="recipients">
            <RecipientsTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="exit-reasons">
            <ExitReasonsTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="units">
            <UnitsTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="technical-conditions">
            <TechnicalConditionsTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="backup">
            <BackupTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="import">
            <ImportTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="import-equipment">
            <ImportEquipmentTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────
