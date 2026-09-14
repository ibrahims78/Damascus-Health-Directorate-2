# تشغيل المشروع على Replit

هذا المشروع عبارة عن pnpm monorepo يضم واجهة React/Vite وخادم Express يستخدم قاعدة PGlite محلية.

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

## البيانات المحلية

- تُحفظ بيانات التطوير في `.damascus-data/`.
- يستخدم الخادم المخطط `lib/db/desktop-schema.sql`.
- عند أول تشغيل، تعرض الواجهة نموذج إنشاء حساب المدير ولا توجد بيانات دخول افتراضية.

## التحقق

```bash
pnpm run typecheck
curl http://127.0.0.1:8080/api/healthz
```