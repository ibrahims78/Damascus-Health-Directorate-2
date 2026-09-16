import { useMemo, useState } from 'react';
import {
  Activity,
  Sparkles,
  AlertCircle,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Info,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Operation = {
  id: string;
  title: string;
  summary: string;
  icon: typeof ArrowDownToLine;
  tone: string;
  when: string;
  steps: string[];
  notes: string[];
  href: string;
};

const troubleshootingItems: Array<{ problem: string; solution: string }> = [
  {
    problem: 'لا يمكن الإرسال في التحويل: الرصيد غير كافٍ',
    solution:
      'الرسالة INSUFFICIENT_STOCK تعني أن الكمية أكبر من رصيد مستودع المصدر في دفتر الدفعات. راجع «الأرصدة حسب المستودع» أو خفّض الكمية.',
  },
  {
    problem: 'لا يمكن اعتماد جلسة الجرد',
    solution:
      'يجب جرد كل الأسطر أولًا (COUNT_INCOMPLETE)، وتسجيل سبب لكل فرق (COUNT_VARIANCE_REASON_REQUIRED). الجلسة المفتوحة لا تؤثر على المخزون.',
  },
  {
    problem: 'الاستيراد رفض الملف',
    solution:
      'الوحدة والتصنيف يجب أن يطابقا ورقة «القيم المرجعية»، ولا يُسمح بأعمدة كمية في قالب الكتالوج، والسطر المكرر داخل الملف يُرفض. نزّل تقرير الأخطاء CSV وصحّح الأسطر المذكورة ثم أعد الرفع.',
  },
  {
    problem: 'رمز المصادقة الثنائية مرفوض',
    solution:
      'اضبط ساعة الجهاز (يُقبل فرق دقيقة واحدة). وإذا كان الحساب مُفعّلًا وفُقد الجهاز، على المدير استخدام POST /api/auth/2fa/reset بمعرّف المستخدم.',
  },
  {
    problem: 'رقم السند غير متوقع',
    solution:
      'الترقيم = كود المستودع-النوع-السنة-تسلسل (000001…). تغيير المستودع الحالي يغيّر البادئة، وكل مستودع له عدّاده المستقل.',
  },
  {
    problem: 'الواجهة كانت تعرض العربية مشوّهة',
    solution:
      'كان خلل ترميز في إصدار سابق، وصُحّح بالكامل في 5.0.1. ويوجد فحص آلي (docs/tests/encoding-check.mjs) يمنع عودة التشويه.',
  },
];

const newsItems: Array<{ version: string; title: string; detail: string }> = [
  { version: '5.0.1', title: 'إصلاح ترميز العربية', detail: 'كانت بعض الشاشات تعرض نصوصًا مشوّهة؛ صُحّح الترميز بالكامل وأُضيف فحص آلي يمنع عودته، والعربية الآن سليمة في كل الواجهات والتقارير.' },
  { version: '5.0.0', title: 'المصادقة الثنائية (2FA)', detail: 'رمز زمني من تطبيق مصادقة بعد كلمة المرور — على سطح المكتب وعلى الهاتف، مع استعادة الحساب بواسطة المدير.' },
  { version: '5.0.0', title: 'ملصقات المواقع', detail: 'صفحة ملصقات قابلة للطباعة لكل موقع تخزين بالباركود والاسم والمنطقة.' },
  { version: '4.8.0', title: 'مواقع التخزين (Zone/Bin)', detail: 'كتالوج مواقع بترميز فريد يُسند للمواد ويظهر في الجرد والتقارير.' },
  { version: '4.7.0', title: 'إشعارات خارجية (Webhook)', detail: 'إرسال حمولة JSON عند إنشاء أو تصعيد أي تنبيه إلى «حرج».' },
  { version: '4.6.0', title: 'سندات الاستلام (GRN) بفحص', detail: 'استلام بكميات مقبولة ومرفوضة وسبب إلزامي للرفض، ولا يدخل المخزون إلا المقبول.' },
  { version: '4.5.0', title: 'الجرد الدوري · القيد العكسي · فروق التحويلات · إعادة الطلب · مؤشرات KPI/ABC', detail: 'حزمة الرقابة وإدارة المخزون المتقدمة.' },
];

const operations: Operation[] = [
  {
    id: 'inbound',
    title: 'إدخال مادة إلى المستودع',
    summary: 'تسجيل الكميات الواردة مع مصدرها وبيانات الصنف والتشغيلة والصلاحية.',
    icon: ArrowDownToLine,
    tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    when: 'تستخدم عند استلام توريد أو مناقلة أو أي كمية تزيد الرصيد الفعلي.',
    steps: [
      'من لوحة التحكم أو سجل العمليات اختر «إدخال مادة».',
      'حدد نوع الصنف: مادة/مستهلك أو تجهيز، ثم اختر السجل من القائمة.',
      'أدخل الكمية والوحدة ورقم السند والمصدر، وأكمل بيانات التشغيلة والصلاحية عند الحاجة.',
      'راجع الملخص الظاهر قبل الحفظ، ثم اضغط «تأكيد وتسجيل الحركة».',
      'تحقق من رقم المستند الجديد وتحديث الرصيد في صفحة الصنف.',
    ],
    notes: [
      'للأصناف ذات الصلاحية، أدخل تاريخ الانتهاء بدقة حتى تعمل تنبيهات FEFO.',
      'لا يمكن حذف الحركة بعد اعتمادها؛ استخدم التسوية لتصحيح فرق موثق.',
    ],
    href: '/transactions/in/new',
  },
  {
    id: 'outbound',
    title: 'إخراج مادة من المستودع',
    summary: 'تسجيل صرف المواد للجهة المستلمة مع خصم الرصيد وإصدار سند قابل للطباعة.',
    icon: ArrowUpFromLine,
    tone: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20',
    when: 'تستخدم عند صرف مادة أو مستهلك إلى قسم أو جهة مستلمة.',
    steps: [
      'اختر «إخراج مادة» من لوحة التحكم أو سجل العمليات.',
      'حدد الصنف والكمية والجهة المستلمة وسبب الصرف ورقم السند.',
      'راجع الرصيد المتاح والتنبيه إن كانت الكمية ستخفض المخزون تحت الحد الأدنى.',
      'أكّد الحركة بعد مراجعة البيانات؛ يخصم النظام الكمية تلقائياً.',
      'اطبع السند أو ارجع إليه لاحقاً من سجل العمليات باستخدام رقم المستند.',
    ],
    notes: [
      'يمنع النظام صرف كمية أكبر من الرصيد المتاح.',
      'يفضل تسجيل اسم الجهة المستلمة بوضوح لتسهيل البحث والتدقيق لاحقاً.',
    ],
    href: '/transactions/out/new',
  },
  {
    id: 'custody-out',
    title: 'تسليم عهدة شخصية',
    summary: 'تسليم تجهيز أو مادة لشخص مع إنشاء عهدة مفتوحة قابلة للمتابعة والإعادة.',
    icon: UserRoundCheck,
    tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20',
    when: 'تستخدم عندما يصبح الصنف أو التجهيز مسؤولية موظف محدد.',
    steps: [
      'افتح «تسليم عهدة شخصية» من قائمة عمليات العهد والأحداث.',
      'اختر المستلم، ثم حدد المادة أو التجهيز والكمية والحالة عند التسليم.',
      'أدخل رقم العهدة أو الملاحظات والجهة/القسم إن وجدت.',
      'راجع الإقرار الظاهر ثم سجّل الحركة.',
      'تابع العهد المفتوحة من صفحة التقارير أو تفاصيل العهدة.',
    ],
    notes: [
      'سجل الحالة والملاحظات عند التسليم لتكون مرجعاً عند الإعادة.',
      'العهدة لا تغلق إلا بعملية إعادة مرتبطة بها.',
    ],
    href: '/custody/out/new',
  },
  {
    id: 'custody-return',
    title: 'إعادة عهدة',
    summary: 'إغلاق عهدة قائمة وتوثيق الكمية والحالة والملاحظات عند الإعادة.',
    icon: RotateCcw,
    tone: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20',
    when: 'تستخدم عند إعادة ما تم تسليمه كعهدة، كلياً أو جزئياً.',
    steps: [
      'افتح «إعادة عهدة» واختر العهدة المفتوحة من القائمة.',
      'حدد الكمية المعادة وحالة الصنف عند الاستلام.',
      'أضف أي ملاحظات عن النقص أو العطل أو التلف إن وجدت.',
      'راجع الحركة ثم أكد التسجيل.',
      'تأكد من تغير حالة العهدة في تفاصيلها ومن عودة الرصيد المناسب للمخزون.',
    ],
    notes: [
      'إذا كانت الحالة غير سليمة، سجّل التفاصيل بدقة ولا تكتفِ بعبارة عامة.',
      'الإعادة الجزئية تترك الجزء المتبقي كعهدة مفتوحة.',
    ],
    href: '/custody/return/new',
  },
  {
    id: 'damage',
    title: 'تسجيل تلف',
    summary: 'توثيق الصنف أو التجهيز التالف مع رقم المحضر والحالة والإجراء المتخذ.',
    icon: FileWarning,
    tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
    when: 'تستخدم عند اكتشاف تلف أو فقدان صلاحية أو عدم قابلية للاستخدام.',
    steps: [
      'افتح «تسجيل تلف» من قائمة عمليات العهد والأحداث.',
      'اختر الصنف أو التجهيز والكمية أو الرقم التسلسلي المتأثر.',
      'أدخل رقم المحضر ووصفاً واضحاً للحالة والإجراء المقترح.',
      'أضف أي مرجع داخلي في الملاحظات عند توفره.',
      'أكد التسجيل وتحقق من انعكاس الحركة على الرصيد والحالة.',
    ],
    notes: [
      'وثّق تفاصيل التلف كتابياً بما يكفي ليفهمها المدقق دون الرجوع إليك.',
      'التسجيل النهائي حركة تدقيق، لذلك راجع الكمية قبل الاعتماد.',
    ],
    href: '/damage/new',
  },
  {
    id: 'central-return',
    title: 'مرتجع مركزي',
    summary: 'إرجاع مواد إلى الجهة المركزية مع حفظ مصدر المرتجع والوثائق المرتبطة.',
    icon: ArchiveRestore,
    tone: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    when: 'تستخدم عند إعادة مواد إلى المستودع المركزي أو الجهة الموردة.',
    steps: [
      'افتح «مرتجع مركزي» وحدد الصنف والكمية المعادة.',
      'أدخل الجهة المركزية ورقم المرجع أو مستند الإرجاع.',
      'أدخل رقم المحضر وأضف ملاحظات عن حالة العبوة أو التشغيلة.',
      'راجع تفاصيل الحركة ثم اعتمد التسجيل.',
      'احتفظ برقم المستند للرجوع إليه ضمن سجل العمليات والتقارير.',
    ],
    notes: [
      'المرتجع المركزي يختلف عن إعادة العهدة: الأول للجهة المركزية، والثاني لمستلم عهدة.',
      'تأكد من اختيار التشغيلة الصحيحة عند وجود أكثر من تشغيلة للصنف.',
    ],
    href: '/central-return/new',
  },
  {
    id: 'adjustment',
    title: 'تسوية جرد',
    summary: 'مطابقة الرصيد النظامي مع الكمية الفعلية بعد جرد موثق.',
    icon: ClipboardCheck,
    tone: 'text-slate-600 dark:text-slate-300 bg-slate-500/10 border-slate-500/20',
    when: 'تستخدم فقط عند ظهور فرق بين الجرد الفعلي والرصيد المسجل.',
    steps: [
      'افتح الصنف أو التجهيز واختر «تسوية جرد».',
      'أدخل الكمية الفعلية التي تم عدّها، ولا تعدّل الكمية النظامية يدوياً.',
      'أدخل رقم محضر الجرد أو اسم اللجنة في حقل رقم المحضر أو الملاحظات.',
      'راجع الفرق الناتج واتجاه التسوية قبل الحفظ.',
      'اعتمد الحركة ثم استخدم سجل التدقيق للتأكد من توثيقها.',
    ],
    notes: [
      'التسوية ليست بديلاً عن إدخال أو إخراج صحيح؛ استخدمها للفرق المثبت فقط.',
      'يفضل تنفيذ الجرد مع شخصين ومراجعة التقرير قبل اعتماد التسوية.',
    ],
    href: '/items',
  },
  {
    id: 'catalog',
    title: 'الكتالوج والوحدات المعيارية',
    summary: 'مصدر التعريف الوحيد: المواد والتجهيزات والوحدات والتصنيفات، مع أداة توحيد الوحدات النصّية.',
    icon: BookOpen,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'عند تعريف صنف جديد، أو توحيد وحدات مكتوبة يدويًا، أو ضبط الحد الأدنى.',
    steps: [
      'افتح «الكتالوج» ← تبويب «الوحدات» ← «الوحدات الافتراضية» لإدراج الوحدات المعيارية.',
      'في تبويبات المواد والتجهيزات راجع الرموز والوحدات والحد الأدنى؛ التعديل للمدير فقط.',
      'استخدم لوحة «توحيد الوحدات»: تُبرز الوحدات غير المعيارية وتوحّدها عبر كل الأصناف.',
      'الصنف المستخدم في حركات لا يُحذف؛ يُؤرشف فقط للحفاظ على التتبّع.',
    ],
    notes: [
      'لا يمكن تغيير رمز أو وحدة مادة لها حركات مسجّلة.',
      'رمز التجهيز فريد، وأرشفة التجهيز تُخفيه من القوائم دون حذف بياناته.',
    ],
    href: '/catalog',
  },
  {
    id: 'warehouses',
    title: 'المستودعات وربط الجهاز',
    summary: 'تعريف المستودعات (مركزي/فرعي) وربط كل جهاز بمستودعه، مع ترقيم مستندات ببادئة المستودع.',
    icon: ArchiveRestore,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'عند تجهيز فرع جديد أو فتح قاعدة بيانات جديدة.',
    steps: [
      'افتح «الكتالوج» ← تبويب «المستودعات» لإنشاء مستودع برمز قصير (مثل S01).',
      'اضغط «تعيين كمستودع للجهاز» لتحديد مستودع هذا الجهاز.',
      'يُنشأ تلقائيًا مستودع مركزي افتراضي (C) وتُنسب إليه البيانات القديمة.',
      'تصبح أرقام المستندات: كود-نوع-سنة-تسلسل (مثال S01-IN-2026-000003).',
    ],
    notes: [
      'الترقيم بعدّاد ذرّي لكل مستودع فلا يتصادم بعد دمج المواقع.',
      'الفروع ترى رصيدها فقط؛ الإجمالي الموحّد للمدير.',
    ],
    href: '/catalog',
  },
  {
    id: 'transfers',
    title: 'التحويلات بين المستودعات',
    summary: 'دورة كاملة: طلب ← إرسال ← استلام، مع إيصال استلام مبدئي ومستند قابل للطباعة.',
    icon: ArrowRight,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'عند حاجة فرع إلى مادة من المركزي أو إعادة توزيع كميات.',
    steps: [
      'من «التحويلات» اضغط «طلب تحويل» وحدّد المستودعين والصنف والكمية (والدفعة/الصلاحية عند اللزوم).',
      'الطلب لا يمسّ الأرصدة ويبقى بحالة «مطلوب».',
      '«إرسال» من المصدر: ينقص رصيده فورًا وتصبح الحالة «قيد النقل».',
      '«استلام» في الوجهة: يزيد رصيدها فورًا وتُنشأ دفعة جديدة.',
      'إن وصلت البضاعة قبل المستند سجّل «إيصال استلام مبدئي» ثم يُطابق لاحقًا.',
      'اطبع المستند من زر «طباعة» بتنسيق A4 مع خانات التوقيع.',
    ],
    notes: [
      'التحويل يمرّ عبر المركزي دائمًا في الطوبولوجيا المعتمدة.',
      'لا تنتظر أي خطوة المزامنة؛ كل حركة تُسجَّل محليًا وفورًا.',
    ],
    href: '/transfers',
  },
  {
    id: 'inventory-hub',
    title: 'مركز المخزون والترصيد',
    summary: 'صورة موحّدة: الإجماليات والنواقص وحالة التجهيزات ولوحة ترصيد الرصيد مع الدفعات.',
    icon: LayoutDashboard,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'للمتابعة الدورية أو عند الشك في فرق بين الرصيد المسجّل ومجموع الدفعات.',
    steps: [
      'افتح «مركز المخزون» لمراجعة المؤشرات والمواد تحت الحد الأدنى وحالة التجهيزات.',
      'راجع «ترصيد الأرصدة مع الدفعات»: يعرض الأصناف التي فيها فرق ومقداره.',
      'أي فرق يحتاج قرارًا موثّقًا من المدير؛ لا تصحيح صامت.',
    ],
    notes: ['المخزون المخزَّن يُحتسب من سجل الدفعات لكل مستودع.'],
    href: '/inventory',
  },
  {
    id: 'consolidated-reports',
    title: 'التقارير الموحّدة',
    summary: 'إجماليات كل المواقع مع تفصيل لكل مستودع وتنبيه الحد الأدنى لكل موقع.',
    icon: BarChart3,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'لعرض الصورة الشاملة على الإدارة ومقارنة المواقع.',
    steps: [
      'من «مركز المخزون» (بحساب المدير) افتح بطاقة «التقارير الموحّدة».',
      'راجع إجمالي الكميات وعدد الأصناف تحت الحد الأدنى وعدد المستودعات.',
      'استخدم صفوف المستودعات لمقارنة الأرصدة بين المواقع.',
    ],
    notes: ['الفرع لا يرى هذه الصورة؛ يرى رصيده فقط (قرار معتمد).'],
    href: '/inventory',
  },
  {
    id: 'sync-admin',
    title: 'إدارة المزامنة متعددة المواقع',
    summary: 'لوحة لمتابعة صادر المزامنة والتعارضات والعُقد الموثوقة، والتشغيل اليدوي عبر ملفات مشفّرة.',
    icon: RefreshCw,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'قبل/بعد كل دورة مزامنة وعند ظهور تعارض أو تراكم تغييرات معلّقة.',
    steps: [
      'افتح «المزامنة» ← «لوحة إدارة المزامنة» لرؤية الهوية والمستودع والصادر والتعارضات والعُقد.',
      'صدّر حزمة .dme-sync بكلمة مرور وانقلها (USB/مجلد شبكة) إلى الطرف الآخر.',
      'استورد الحزمة في الجهة الأخرى (يُفكّ التشفير بعد إدخال كلمة المرور).',
      'راجع التعارضات إن وُجدت وحُلّها من نفس الصفحة.',
    ],
    notes: [
      'استيراد الحزمة نفسها مرتين آمن (منع تكرار بمعرّف العملية).',
      'relay عبر نقطة وسيطة مُعطّل التزامًا بمبدأ «بلا سيرفر مركزي».',
    ],
    href: '/sync',
  },
  {
    id: 'navigation-roles',
    title: "التنقل والصلاحيات — من يرى ماذا",
    summary: "القائمة الجانبية منظمة في ست مجموعات حسب المهمة، وكل مجموعة تظهر للأدوار التي تملكها فقط.",
    icon: ShieldCheck,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: "عند بدء الاستخدام، أو عند إضافة مستخدم، أو عند عدم ظهور عنصر متوقع.",
    steps: [
      "المجموعة 1 — الرئيسية: لوحة المعلومات ومركز المخزون، نقطة الانطلاق لكل الأدوار.",
      "المجموعة 2 — المخزون والتحويلات: المواد والتجهيزات والتحويلات وسجل الحركات.",
      "المجموعة 3 — العمليات اليومية: إدخال وإخراج وتسليم عهدة وإعادة عهدة وتلف ومرتجع مركزي (للمدير وأمين المستودع فقط).",
      "المجموعة 4 — الكتالوج والبيانات: الوحدات والمستودعات والمواد والتجهيزات، التعريف من مكان واحد.",
      "المجموعة 5 — التقارير: التفصيلية والموحدة وسجل التدقيق.",
      "المجموعة 6 — الإدارة: المستخدمون والتدقيق والمزامنة والإعدادات (للمدير فقط).",
      "القاعدة: لا يظهر زر أو صفحة لمستخدم لا يملك تنفيذها، وعند محاولة الوصول مباشرة تظهر شاشة لا تملك الصلاحية.",
    ],
    notes: [
      "المراقب: قراءة وتقارير فقط، بلا أي أزرار تنفيذية أو تعريفية.",
      "أمين المستودع: كل العمليات والتحويلات، وبلا تعريفات ولا إدارة ولا تقارير موحدة.",
      "المدير: كل شيء، بما فيه الكتالوج والإدارة والتقارير الموحدة.",
    ],
    href: '/',
  },
  {
    id: 'help-operation-counts',
    title: 'الجرد الدوري (Cycle Counting)',
    summary: 'جلسة جرد أعمى تُقارن الكمية الفيزيائية بالدفترية، ثم اعتماد المدير يرحّل الفروق كتسويات موثّقة.',
    icon: ClipboardCheck,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'جرد دوري شهري أو ربع سنوي، أو عند الاشتباه بفرق في صنف أو مستودع.',
    steps: [
      'افتح «الجرد الدوري» ثم «جلسة جرد جديدة» (تُنشأ أعمى: الكمية الدفترية مخفية).',
      'أدخل الكمية الفيزيائية لكل سطر، ويمكن «كشف الكمية الدفترية» مؤقّتًا للمراجعة.',
      'عند وجود فرق اكتب سبب الفرق (إلزامي) — لا يمكن الاعتماد قبل جرد كل الأسطر.',
      '«حفظ الكميات» ثم «اعتماد وترحيل الفروق» (للمدير): يُرحّل كل فرق كتسوية عبر دفتر الدفعات.',
    ],
    notes: [
      'لا تُكتب أي تسوية قبل الاعتماد — الجلسة المفتوحة لا تؤثر على المخزون.',
      'بعد الاعتماد يبقى تقرير الترصيد نظيفًا لأن التسوية تُحدّث الدفعات أيضًا.',
    ],
    href: '/counts',
  },
  {
    id: 'help-operation-receipts',
    title: 'سندات الاستلام (GRN) بفحص',
    summary: 'استلام بموجب سند تسليم المورّد: كميات مطلوبة ومستلمة ومرفوضة، ولا يدخل المخزون إلا بالكميات المقبولة عند الترحيل.',
    icon: ClipboardCheck,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'عند وصول شحنة من المورّد، أو استلام جزئي أو ناقص أو تالف.',
    steps: [
      'افتح «سندات الاستلام» ثم أنشئ سندًا: المورّد · رقم سند التسليم · التاريخ · المرجع (أمر شراء).',
      'أضف البنود: الكمية المطلوبة والمستلمة والمرفوضة، وسبب الرفض إلزامي لأي كمية مرفوضة.',
      'يمكن إدخال رقم الدفعة وتاريخ الصلاحية لكل بند ليُفتح بها المخزون.',
      '«حفظ كمسودة» ثم «ترحيل» — تُدخل الكميات المقبولة فقط، والمرفوضة تُسجَّل بلا أثر على الرصيد.',
    ],
    notes: [
      'المسودة لا تؤثر على المخزون إطلاقًا، ولا يمكن ترحيل سند مرتين أو ترحيل سند ملغى.',
      'تقرير أداء المورّدين يوضّح المستلم والمرفوض ونسبة الرفض لكل مورّد.',
    ],
    href: '/receipts',
  },
  {
    id: 'help-operation-reversal',
    title: 'القيد العكسي للحركات',
    summary: 'بدل تعديل حركة مُرحَّلة يُنشأ مستند تعويضي مرتبط بالأصل مع سبب موثّق.',
    icon: RefreshCw,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'خطأ في كمية أو جهة أو سبب بعد الترحيل.',
    steps: [
      'من «سجل الحركات» اضغط أيقونة العكس في سطر الحركة.',
      'اكتب سبب العكس (5 أحرف على الأقل) ثم أكّد.',
      'يُرحَّل قيد عكسي برقم REV-<رقم المستند> وتُعلَّم الحركة الأصلية «معكوسة».',
    ],
    notes: [
      'لا يمكن عكس الحركة مرتين، ولا عكس قيد عكسي.',
      'حركات العهدة تُدار عبر دورة العهدة (إرجاع)، لا عبر القيد العكسي.',
    ],
    href: '/transactions',
  },
  {
    id: 'help-operation-transfer-variance',
    title: 'فروق كميات التحويلات',
    summary: 'تسجيل الكمية المستلمة فعليًا لكل بند عند استلام التحويل، مع حفظ الفرق وسببه في تقرير مخصص.',
    icon: ArrowLeftRight,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'عند وصول بضاعة بمقدار يختلف عن المشحون (نقص أو تلف أو خطأ عدّ).',
    steps: [
      'من «التحويلات» أنشئ طلبًا ثم أرسل (يُخصم من مستودع المصدر).',
      'عند الاستلام أدخل الكمية المستلمة فعليًا لكل بند وسبب الفرق عند وجوده.',
      'راجع تقرير «فروق التحويلات» لمتابعة الفروق ونِسبها.',
    ],
    notes: ['يترقّم التحويل لكل مستودع: كود-النوع-السنة-تسلسل، ولا يُرسل تحويل بلا رصيد كافٍ.'],
    href: '/transfers',
  },
  {
    id: 'help-operation-reorder',
    title: 'إعادة الطلب والكميات المقترحة',
    summary: 'حد إعادة الطلب والحد الأقصى ومخزون الأمان لكل مادة، وتقرير يقترح كمية الطلب.',
    icon: Package,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'لتجنّب النفاد أو التكديس، ولبناء أمر شراء.',
    steps: [
      'من بطاقة المادة حدّد: الحد الأدنى · حد إعادة الطلب · الحد الأقصى · مخزون الأمان.',
      'افتح تقرير «إعادة الطلب» لعرض المواد عند أو تحت حد الطلب مع الكمية المقترحة.',
      'المواد ذات الرصيد صفر تظهر معلَّمة كحالة عاجلة وتُقدَّم في الترتيب.',
    ],
    notes: ['الكمية المقترحة = الحد الأقصى − الرصيد الحالي (وبدون حد أقصى تُحسب ضعف حد إعادة الطلب).'],
    href: '/inventory',
  },
  {
    id: 'help-operation-kpi',
    title: 'مؤشرات الأداء وتصنيف ABC',
    summary: 'لوحة مؤشرات: معدل الدوران · أيام التغطية · المخزون الراكد · النفاد · دقة الجرد، وتصنيف ABC للمواد.',
    icon: BarChart3,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'مراجعة شهرية لأداء المخزون أو تحضير تقرير للإدارة.',
    steps: [
      'افتح «مركز المخزون» ثم قسم المؤشرات (دوران · تغطية · راكد · نفاد · دقة الجرد).',
      'راجع تصنيف ABC: المواد A هي الأعلى استهلاكًا (80% من الحركة) وتستحق متابعة أدق.',
      'استخدم «دقة الجرد» لمتابعة أثر الجلسات الدورية على انضباط الأرصدة.',
    ],
    notes: ['المؤشرات تُحسب على نافذة 90 يومًا للاستهلاك و180 يومًا للركود، وتظهر للمدير فقط.'],
    href: '/inventory',
  },
  {
    id: 'help-operation-bins',
    title: 'مواقع التخزين (Zone/Bin) والملصقات',
    summary: 'كتالوج مواقع بترميز فريد ومنطقة ومستودع يُسند للصنف، مع صفحة ملصقات قابلة للطباعة بالباركود.',
    icon: MapPin,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'تنظيم الأرفف وتقليل زمن البحث والخطأ في الصرف.',
    steps: [
      'من «الكتالوج» ← تبويب «المواقع» أضف موقعًا (مثال: A-01-1) بمنطقة ومستودع.',
      'أسند الموقع للصنف في حقل «الموقع»، وسيظهر في الجرد والتقارير.',
      'من «ملصقات المواقع» حدّد المواقع ثم اطبع ورقة الملصقات (باركود + اسم + منطقة).',
    ],
    notes: ['لا يمكن أرشفة موقع مرتبط بأصناف، وتقرير استخدام المواقع يكشف الرموز غير المعرّفة لتصحيحها.'],
    href: '/labels',
  },
  {
    id: 'help-operation-webhook',
    title: 'الإشعارات الخارجية (Webhook)',
    summary: 'إرسال حمولة JSON إلى عنوان تحدّده عند إنشاء أي تنبيه أو تصعيده إلى «حرج».',
    icon: Activity,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'ربط التطبيق بنظام مراقبة أو قناة إشعارات عبر وسيط.',
    steps: [
      'يضبط المدير العنوان عبر PUT /api/settings بالحقل alertWebhookUrl (http أو https).',
      'عند حدث تنبيه يُرسل: source و generatedAt وقائمة alerts، بمهلة 5 ثوانٍ.',
    ],
    notes: ['فشل الإرسال لا يؤثر على التنبيهات الداخلية ولا على عمل النظام.'],
    href: '/settings',
  },
  {
    id: 'help-operation-2fa',
    title: 'المصادقة الثنائية (2FA)',
    summary: 'رمز زمني (TOTP) من تطبيق مصادقة يُطلب بعد كلمة المرور — على سطح المكتب وعلى الهاتف.',
    icon: ShieldCheck,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'الحسابات المميّزة (مدير النظام وأمناء المستودعات).',
    steps: [
      'الإعداد: POST /api/auth/2fa/setup للحصول على المفتاح ورابط otpauth، ثم أضِفه لتطبيق المصادقة.',
      'التفعيل: POST /api/auth/2fa/enable مع الرمز الحالي، وبعدها يسأل الدخول عن الرمز.',
      'التعطيل: POST /api/auth/2fa/disable مع رمز صحيح.',
    ],
    notes: [
      'اضبط ساعة الجهاز: النظام يقبل فرقًا دقيقة واحدة في الاتجاهين.',
      'عند فقدان الجهاز يستخدم المدير POST /api/auth/2fa/reset مع معرّف المستخدم.',
    ],
    href: '/settings',
  },
  {
    id: 'help-operation-scope',
    title: 'نطاق المستودع للمستخدم',
    summary: 'ربط المستخدم بمستودع يقيّده به: يرى حركات وجرد وسندات مستودعه فقط ولا ينشئ مستندًا لمستودع آخر.',
    icon: Users,
    tone: 'text-primary bg-primary/10 border-primary/20',
    when: 'فصل عمل الفروع وأمناء المستودعات، وتحقيق فصل المهام.',
    steps: [
      'من «المستخدمون» حدّد «المستودع» عند إنشاء أو تعديل المستخدم.',
      'المستخدم بلا مستودع يبقى بصلاحية كاملة، والمدير يرى كل المواقع دائمًا.',
    ],
    notes: ['الترقيم مستقل لكل مستودع، فالحركة تحمل كود المستودع الذي أُنشئت فيه.'],
    href: '/users',
  },
];

const featureCards = [
  { icon: LayoutDashboard, title: 'لوحة تحكم فورية', text: 'ملخص الرصيد، النواقص، المنتهي، التجهيزات والعمليات الحديثة في شاشة واحدة.', color: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
  { icon: Package, title: 'إدارة المواد والمستهلكات', text: 'سجل مركزي للأصناف والتصنيفات والوحدات والتشغيلات والصلاحية والحد الأدنى.', color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
  { icon: Stethoscope, title: 'إدارة التجهيزات الطبية', text: 'متابعة الأجهزة والأرقام التسلسلية والحالة والصيانة والعهدة المرتبطة بها.', color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
  { icon: BarChart3, title: 'تقارير قابلة للتنفيذ', text: 'تقارير الجرد والحركة والنواقص والصلاحية والتجهيزات والعهد المفتوحة مع الطباعة والتصدير.', color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  { icon: AlertCircle, title: 'تنبيهات استباقية', text: 'تنبيه عند انخفاض الرصيد أو قرب انتهاء الصلاحية أو وجود تجهيز يحتاج صيانة.', color: 'text-red-600 dark:text-red-400 bg-red-500/10' },
  { icon: ShieldCheck, title: 'تدقيق وصلاحيات', text: 'أدوار واضحة وسجل تدقيق للحركات والتغييرات الحساسة لضمان المسؤولية.', color: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10' },
];

const workflowSteps = [
  { number: '01', title: 'تحقق من لوحة التحكم', text: 'ابدأ بمراجعة النواقص والتنبيهات والعمليات الأخيرة قبل أي حركة.', icon: LayoutDashboard },
  { number: '02', title: 'اختر العملية المناسبة', text: 'استخدم العملية التي تصف الواقع بدقة، ولا تعالج حركة عادية كتسوية.', icon: Search },
  { number: '03', title: 'أدخل البيانات والمرجع', text: 'املأ الكمية والجهة ورقم المستند والتفاصيل التي يحتاجها التدقيق.', icon: ClipboardCheck },
  { number: '04', title: 'راجع ثم اعتمد', text: 'اقرأ ملخص التأكيد قبل التسجيل، فالحركات المعتمدة تظهر في السجل ولا تحذف.', icon: CheckCircle2 },
  { number: '05', title: 'تابع الأثر', text: 'تأكد من الرصيد والتقرير أو العهدة، واطبع السند عند الحاجة.', icon: Activity },
];

const roleRows = [
  { role: 'مدير النظام', access: 'إدارة كاملة، المستخدمون، الإعدادات، التدقيق والمزامنة.', icon: KeyRound },
  { role: 'أمين المستودع', access: 'إدارة المواد والتجهيزات وتسجيل الحركات والتقارير التشغيلية.', icon: Package },
  { role: 'مراقب', access: 'عرض البيانات والتقارير والتنبيهات دون تنفيذ العمليات الحساسة.', icon: Users },
];

const glossary = [
  ['الرصيد', 'الكمية المسجلة والمتاحة في المستودع بعد احتساب الحركات المعتمدة.'],
  ['العهدة', 'كمية أو تجهيز أصبح مسؤولية مستلم محدد، وتبقى مفتوحة حتى الإعادة الكاملة.'],
  ['التسوية', 'حركة موثقة لمعالجة فرق مثبت بين الجرد الفعلي والرصيد النظامي.'],
  ['FEFO', 'صرف الدفعات الأقرب إلى انتهاء الصلاحية أولاً لتقليل الهدر.'],
  ['المزامنة', 'تبادل التغييرات بين عقد موثوقة مع كشف التكرار والتعارض قبل التطبيق.'],
];

const faqs = [
  ['متى أستخدم التسوية بدل الإدخال أو الإخراج؟', 'استخدم التسوية فقط عندما يثبت الجرد فرقاً عن الرصيد المسجل. الحركة العادية يجب أن تسجل كإدخال أو إخراج حتى يبقى التدقيق دقيقاً.'],
  ['هل يمكن حذف حركة معتمدة؟', 'لا. الحركات المعتمدة جزء من سجل التدقيق؛ صححها بحركة جديدة موثقة أو بتسوية مبررة حسب الحالة.'],
  ['كيف أتعامل مع تعارض مزامنة حرج؟', 'أوقف التطبيق، راجع العنصر ورقم العملية في طابور التعارضات، ثم اعتمد أو ارفض بعد التحقق من المستند الأصلي. لا تتجاهل التعارض الحرج.'],
  ['ما الفرق بين النسخة الاحتياطية وحزمة المزامنة؟', 'النسخة الاحتياطية تحفظ حالة قاعدة البيانات للفحص والاستعادة، أما حزمة المزامنة فتنقل تغييرات قابلة للتطبيق بين عقد موثوقة. كلاهما مشفر ويحتاج كلمة المرور الخاصة به.'],
];

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof BookOpen;
}) {
  return (
    <div className="mb-6 flex items-start gap-3" dir="rtl">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function OperationCard({ operation }: { operation: Operation }) {
  const Icon = operation.icon;
  return (
    <Card id={operation.id} className="scroll-mt-6 overflow-hidden border-border/80 shadow-sm transition-shadow hover:shadow-md" dir="rtl">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex items-start gap-3">
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border', operation.tone)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{operation.title}</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{operation.summary}</p>
          </div>
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">عملية موثقة</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-sm leading-6">
          <span className="font-semibold text-primary">متى تستخدمها؟ </span>
          <span className="text-foreground/80">{operation.when}</span>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <ArrowLeft className="h-4 w-4 text-primary" />
              خطوات التنفيذ
            </h3>
            <ol className="space-y-3">
              {operation.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Info className="h-4 w-4 text-amber-500" />
              نقاط مهمة
            </h3>
            <ul className="space-y-3">
              {operation.notes.map(note => (
                <li key={note} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                  <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end border-t pt-4">
          <Link href={operation.href} data-testid={`link-help-${operation.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            الانتقال إلى العملية
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function HelpPage() {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase('ar');
  const filteredOperations = useMemo(
    () => operations.filter((operation) =>
      !normalizedSearch ||
      [operation.title, operation.summary, operation.when, ...operation.steps, ...operation.notes]
        .join(' ')
        .toLocaleLowerCase('ar')
        .includes(normalizedSearch),
    ),
    [normalizedSearch],
  );

  const filteredTroubleshooting = useMemo(
    () =>
      troubleshootingItems.filter(
        (item) => !normalizedSearch || `${item.problem} ${item.solution}`.toLocaleLowerCase('ar').includes(normalizedSearch),
      ),
    [normalizedSearch],
  );
  const filteredNews = useMemo(
    () =>
      newsItems.filter(
        (item) => !normalizedSearch || `${item.version} ${item.title} ${item.detail}`.toLocaleLowerCase('ar').includes(normalizedSearch),
      ),
    [normalizedSearch],
  );
  const resultCount = normalizedSearch
    ? filteredOperations.length + filteredTroubleshooting.length + filteredNews.length
    : null;
  return (
    <div className="mx-auto max-w-6xl space-y-12 pb-10" dir="rtl">
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary/90 to-cyan-700 px-6 py-8 text-primary-foreground shadow-lg md:px-10 md:py-10">
        <div className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-20 right-10 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <Badge className="border-white/20 bg-white/10 text-white hover:bg-white/10">دليل المستخدم الرسمي</Badge>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-4xl">مركز مساعدة مستودعات مديرية صحة دمشق</h1>
          <p className="mt-4 max-w-2xl text-sm leading-8 text-white/85 md:text-base">
            مرجع عملي موحد لإدارة مخزون المواد والتجهيزات الطبية في دمشق. اتبع الخطوات أدناه لتسجيل كل حركة بشكل صحيح، ثم راقب أثرها في الرصيد والتقارير.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs text-white/80">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5"><ShieldCheck className="h-3.5 w-3.5" />توثيق كامل للحركات</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5"><Activity className="h-3.5 w-3.5" />بيانات لحظية</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5"><BookOpen className="h-3.5 w-3.5" />دليل عربي تفصيلي</span>
          </div>
        </div>
      </section>

      <nav aria-label="فهرس دليل المساعدة" className="rounded-xl border bg-card p-4 shadow-sm" dir="rtl">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold">
          <Search className="h-4 w-4 text-primary" />
          انتقال سريع داخل الدليل
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث عن عملية أو مصطلح أو سؤال..."
            aria-label="البحث في مركز المساعدة"
            className="h-11 w-full rounded-lg border bg-background px-10 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
          {resultCount !== null && (
            <p className="mt-2 text-xs text-muted-foreground">عدد النتائج: {resultCount}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ['#overview', 'التعريف'],
            ['#workflow', 'طريقة العمل'],
            ['#operations', 'العمليات'],
            ['#monitoring', 'المتابعة'],
            ['#roles', 'الصلاحيات'],
            ['#glossary', 'المصطلحات'],
            ['#faq', 'الأسئلة الشائعة'],
            ['#help-operation-counts', 'الجرد الدوري'],
            ['#help-operation-receipts', 'سندات الاستلام'],
            ['#help-operation-reversal', 'القيد العكسي'],
            ['#help-operation-bins', 'المواقع والملصقات'],
            ['#help-operation-2fa', 'المصادقة الثنائية'],
            ['#troubleshooting', 'استكشاف الأخطاء'],
            ['#whats-new', 'ما الجديد'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              data-testid={`link-help-section-${href.slice(1)}`}
              className="rounded-lg border bg-background px-3 py-2 text-center text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <section id="overview" className="scroll-mt-6">
        <SectionHeading
          eyebrow="01 / التعريف"
          title="ما هو المستودع؟"
          description="مستودع تشغيلي لإدارة دورة حياة المخزون من الاستلام وحتى الصرف أو الإرجاع أو الإتلاف، مع فصل واضح بين المواد الاستهلاكية والتجهيزات الطبية."
          icon={BookOpen}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featureCards.map(feature => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="border-border/80 transition-transform hover:-translate-y-0.5" data-testid={`card-help-feature-${feature.title}`}>
                <CardContent className="p-5">
                  <div className={cn('mb-4 flex h-10 w-10 items-center justify-center rounded-xl', feature.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{feature.text}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="workflow" className="scroll-mt-6">
        <SectionHeading
          eyebrow="02 / طريقة العمل"
          title="الدورة اليومية المقترحة"
          description="هذه الدورة تساعد على إبقاء الأرصدة دقيقة وتجعل كل حركة قابلة للمراجعة من أول إدخالها حتى ظهورها في التقرير."
          icon={RefreshCw}
        />
        <div className="grid gap-3 md:grid-cols-5">
          {workflowSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="relative rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-primary/60">{step.number}</span>
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="mt-4 text-sm font-bold">{step.title}</h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{step.text}</p>
                {index < workflowSteps.length - 1 && <ArrowLeft className="absolute -left-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-background text-primary md:block" />}
              </div>
            );
          })}
        </div>
      </section>

      <section id="operations" className="scroll-mt-6">
        <SectionHeading
          eyebrow="03 / العمليات"
          title="شرح العمليات خطوة بخطوة"
          description="اختر العملية التي تطابق الحدث الفعلي. جميع الحركات المعتمدة تنشئ مستنداً مستقلاً وتظهر في سجل العمليات والتدقيق."
          icon={ArrowRight}
        />
        <div className="space-y-5">
          {filteredOperations.length ? filteredOperations.map(operation => <OperationCard key={operation.id} operation={operation} />) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              لا توجد عملية مطابقة. جرّب كلمة أخرى مثل «إدخال» أو «عهدة» أو «تسوية».
            </div>
          )}
        </div>
      </section>

      <section id="monitoring" className="scroll-mt-6">
        <SectionHeading
          eyebrow="04 / المتابعة"
          title="الجرد والتقارير والتنبيهات"
          description="لا ينتهي العمل عند تسجيل الحركة؛ راجع أثرها باستمرار لضمان أن القرار التشغيلي مبني على بيانات صحيحة."
          icon={BarChart3}
        />
        <div className="grid gap-5 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><LayoutDashboard className="h-4 w-4 text-primary" />لوحة التحكم</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>تعرض مؤشرات المخزون والعمليات الشهرية وآخر الحركات وتوزيع الكميات حسب التصنيف.</p>
              <p>استخدم البطاقات كاختصارات مباشرة للانتقال إلى الأصناف الناقصة أو المنتهية أو التجهيزات التي تحتاج انتباهاً.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-amber-500" />التقارير</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>استخدم تقرير الجرد للمطابقة، وتقرير الحركة للتتبع، وتقارير الصلاحية والحد الأدنى للتخطيط المبكر.</p>
              <p>يمكن طباعة النتائج أو تصديرها عند الحاجة إلى مشاركة رسمية أو أرشفة.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertCircle className="h-4 w-4 text-red-500" />التنبيهات</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>يراقب النظام انخفاض المخزون وقرب انتهاء الصلاحية وحالات صيانة التجهيزات.</p>
              <p>افتح التنبيه للانتقال إلى السجل المرتبط، ثم علّمه كمقروء أو عالجه حسب صلاحيتك.</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="glossary" className="scroll-mt-6">
        <SectionHeading
          eyebrow="06 / المصطلحات"
          title="قاموس سريع"
          description="تعريفات مختصرة للمصطلحات التي تظهر في النماذج والتقارير والمزامنة."
          icon={BookOpen}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {glossary.map(([term, description]) => (
            <Card key={term}>
              <CardContent className="p-4">
                <h3 className="font-bold text-primary">{term}</h3>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="faq" className="scroll-mt-6">
        <SectionHeading
          eyebrow="07 / الأسئلة الشائعة"
          title="إجابات عملية قبل طلب الدعم"
          description="افتح السؤال المطابق للحالة، ثم انتقل إلى الإجراء المرتبط إذا احتجت تنفيذًا فعليًا."
          icon={Info}
        />
        <div className="space-y-3">
          {faqs
            .filter(([question, answer]) => !normalizedSearch || `${question} ${answer}`.toLocaleLowerCase('ar').includes(normalizedSearch))
            .map(([question, answer]) => (
              <details key={question} className="group rounded-xl border bg-card p-4">
                <summary className="cursor-pointer list-none font-semibold marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex items-center justify-between gap-4">
                    {question}
                    <span className="text-primary transition-transform group-open:rotate-45" aria-hidden="true">＋</span>
                  </span>
                </summary>
                <p className="mt-3 border-t pt-3 text-sm leading-7 text-muted-foreground">{answer}</p>
              </details>
            ))}
        </div>
      </section>

      <section id="roles" className="scroll-mt-6">
        <SectionHeading
          eyebrow="05 / الصلاحيات"
          title="الأدوار والمسؤوليات"
          description="تظهر لكل مستخدم الوظائف التي يحتاجها فقط، مع الحفاظ على سجل تدقيق واضح للعمليات."
          icon={Users}
        />
        <Card className="overflow-hidden">
          <div className="divide-y">
            {roleRows.map(row => {
              const Icon = row.icon;
              return (
                <div key={row.role} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center" data-testid={`row-help-role-${row.role}`}>
                  <div className="flex items-center gap-3 sm:w-52 shrink-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
                    <span className="font-bold">{row.role}</span>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{row.access}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="rounded-xl border border-amber-300/50 bg-amber-50/70 p-5 dark:border-amber-800/60 dark:bg-amber-950/20" dir="rtl">
        <div className="flex items-start gap-3">
          <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm leading-7">
            <h2 className="font-bold text-amber-900 dark:text-amber-200">قاعدة ذهبية قبل اعتماد أي حركة</h2>
            <p className="mt-1 text-amber-800/80 dark:text-amber-200/75">
              تأكد من الصنف والكمية والجهة ورقم المرجع. الحركة المعتمدة لا تُحذف، وأي تصحيح لاحق يجب أن يكون حركة جديدة موثقة أو تسوية جرد مبررة.
            </p>
          </div>
        </div>
      </section>

      <section id="whats-new" className="scroll-mt-6">
        <SectionHeading
          eyebrow="10 / ما الجديد"
          title="أحدث ما أُضيف إلى النظام"
          description="ملخّص التحديثات الأخيرة؛ راجع سجل التغييرات الكامل في المستودع."
          icon={Sparkles}
        />
        <div className="space-y-3">
          {filteredNews.map((item) => (
            <div key={`${item.version}-${item.title}`} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono text-[11px]">{item.version}</Badge>
                <span className="text-sm font-bold">{item.title}</span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="troubleshooting" className="scroll-mt-6">
        <SectionHeading
          eyebrow="11 / استكشاف الأخطاء"
          title="أشهر المشكلات وحلولها"
          description="رسائل النظام عربية وتشرح سبب المنع؛ وهذا تفسير أعمق للحالات المتكرّرة مع خطوات الحل."
          icon={AlertCircle}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {filteredTroubleshooting.map((item) => (
            <div key={item.problem} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-start gap-2 text-sm font-bold">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                {item.problem}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{item.solution}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="rounded-xl border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="font-semibold text-foreground">نظام مستودعات مديرية صحة دمشق</div>
            <div>
              الإصدار:{' '}
              {String((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_APP_VERSION ?? '5.0.1')}
            </div>
            <div>تصميم: إبراهيم الصيداوي · 0933706403</div>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/5 print:hidden"
          >
            طباعة صفحة المساعدة
          </button>
        </div>
      </footer>

      <div className="flex justify-center border-t pt-8">
        <Link href="/" data-testid="link-help-home" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowRight className="h-4 w-4" />
          العودة إلى لوحة التحكم
        </Link>
      </div>
    </div>
  );
}