# تقرير إغلاق المرحلة 2: توحيد قاعدة البيانات ومسار migrations

## النطاق

- الهدف: فصل Desktop/PGlite عن PostgreSQL، ومنع API من الإقلاع على schema ناقص.
- الفرع: `main`
- commit التنفيذ: يسجل في commit الذي يضم هذا التقرير.
- المالك: مسؤول قاعدة البيانات
- المراجع: يحدد قبل اعتماد G1
- التاريخ: 17 أيلول 2026

## التغييرات

- تمرير `DATABASE_URL` صراحة إلى Drizzle Kit.
- إضافة migration `0002_sour_leech.sql` للجداول التي كان API يحتاجها ولم تكن
  ضمن سجل migrations السابق، بما فيها warehouses والتحويلات والجرد والاستلام.
- إضافة `db:readiness` وفحص 47 جدولاً والأعمدة الحرجة وسجل Drizzle وآخر
  migration.
- جعل PostgreSQL startup يفشل برسالة واضحة عند schema غير جاهز.
- منع secret الافتراضي في PostgreSQL؛ `SESSION_SECRET` إلزامي خارج Desktop.
- تحديث `healthz` لعرض حالة الخادم وقاعدة البيانات ومصدر المخطط.
- توثيق المسارين في `replit.md` و`docs/operations.md` و
  `docs/database-runbook-ar.md` و`docs/architecture-ar.md`.

## الاختبارات

| الأمر/السيناريو | البيئة | النتيجة | السجل |
|---|---|---|---|
| `pnpm db:migrate` على قاعدة جديدة | PostgreSQL تطوير Replit | PASS | migrations 0→2 |
| `pnpm db:migrate` مرة ثانية | PostgreSQL تطوير Replit | PASS | idempotent |
| `pnpm db:readiness` قبل migration | PostgreSQL تطوير Replit | PASS negative | missing schema واضح |
| `pnpm db:migrate` بعد إضافة migration 0002 | PostgreSQL تطوير Replit | PASS | migrations 3 |
| `pnpm db:readiness` بعد migration | PostgreSQL تطوير Replit | PASS | `status=ready` |
| API PostgreSQL + `GET /api/healthz` | PostgreSQL تطوير Replit | PASS | `mode=postgres` |
| API Desktop + data directory جديد | PGlite مؤقت | PASS | `schemaSource=desktop-schema.sql` |
| `pnpm test` | Vitest 5.0.1 | PASS | readiness وphase2 ضمن 59 اختباراً |

## التوثيق المحدث

- `replit.md`
- `docs/operations.md`
- `docs/database-runbook-ar.md`
- `docs/architecture-ar.md`
- `lib/db/drizzle.config.ts`

## المخاطر المفتوحة

- لم تُنفذ أي migration على production؛ نشر المخطط الإنتاجي يحتاج مسار
  Publish/اعتماد منفصل.
- لا توجد بعد اختبارات استعادة النسخ أو migrations كبيرة؛ هذه مراحل لاحقة.
- يجب اعتماد استراتيجية rollback/compensation لكل migration مستقبلية قبل الدمج.

## القرار

- [ ] اعتماد
- [x] اعتماد مع استثناءات موثقة
- [ ] طلب تعديل
- [ ] إيقاف

## توقيع الاعتماد

- صاحب المشروع:
- المراجع:
- التاريخ: