# تشغيل المشروع على Replit

هذا المشروع عبارة عن pnpm monorepo يضم واجهة React/Vite وخادم Express. يدعم
مسارين منفصلين لقاعدة البيانات:

- Desktop: ‏PGlite مع `lib/db/desktop-schema.sql`.
- PostgreSQL: migrations عبر Drizzle، ولا يبدأ API قبل نجاح فحص الجاهزية.

## التشغيل

استخدم زر **Run** أو شغّل workflow باسم **Start application**. يقوم workflow بما يلي:

- بناء خادم `@workspace/api-server` وتشغيله على المنفذ `8080`.
- تشغيل واجهة `@workspace/web` على المنفذ `5000`.
- تمرير طلبات الواجهة التي تبدأ بـ `/api` إلى الخادم.

## التبعيات

عند استنساخ المشروع في مساحة جديدة:

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

الإصدارات المثبتة للمشروع هي Node.js 22 في CI وpnpm `10.26.1`. لا تستخدم
`pnpm install` غير المقيد في CI؛ يجب أن يظل `pnpm-lock.yaml` مطابقاً.

## بوابات الجودة

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm test:e2e
```

يفشل CI عند فشل النوع أو البناء أو الاختبار أو lint أو E2E. تحذيرات lint
القديمة معلنة في `eslint.config.js` ولا تخفي أخطاء جديدة.

## البيانات المحلية

- تُحفظ بيانات التطوير في `.damascus-data/`.
- يستخدم الخادم المخطط `lib/db/desktop-schema.sql`.
- عند أول تشغيل، تعرض الواجهة نموذج إنشاء حساب المدير ولا توجد بيانات دخول افتراضية.

## PostgreSQL وmigrations

لا يطبق API migrations تلقائياً. نفذ المسار المستضاف قبل التشغيل:

```bash
pnpm --filter @workspace/db run db:migrate
pnpm --filter @workspace/db run db:readiness
```

أو من الجذر:

```bash
pnpm db:migrate
pnpm db:readiness
```

يتحقق readiness من الاتصال، الجداول المطلوبة، الأعمدة الحرجة، سجل
`drizzle.__drizzle_migrations`، وعدد migrations المتوقع. غياب `DATABASE_URL`
يفشل الأمر بوضوح؛ لا يستخدم مسار Desktop هذا الاتصال.

## التحقق

```bash
pnpm run typecheck
curl http://127.0.0.1:8080/api/healthz
```

يعرض `healthz` حالة الخادم وقسم `database` الذي يوضح `mode` و`schemaSource`
وعدد وآخر migration عند استخدام PostgreSQL.