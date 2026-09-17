# Runbook: تعطل قاعدة البيانات

## التمييز

- `mode=desktop`: افحص مسار PGlite وملف schema وملكية مجلد البيانات.
- `mode=postgres`: افحص الاتصال و`db:readiness` والمigration الأخيرة.

## الإجراء

1. اقرأ `healthz` وسجل `database.status` و`schemaSource`.
2. تحقق من أن `DATABASE_URL` موجود في بيئة PostgreSQL فقط.
3. نفذ `pnpm db:readiness` دون تعديل البيانات.
4. إذا كانت الجداول ناقصة، نفذ migration معتمدة فقط.
5. خذ نسخة قبل أي إصلاح بنيوي.
6. لا تستخدم `push-force` ولا تحذف جدولًا لتجاوز الخطأ.

## الاستعادة

إذا فشل readiness بعد migration، أوقف API، احتفظ بالسجل، وارجع إلى
`migration-failure-ar.md` وقرار مسؤول البيانات.
