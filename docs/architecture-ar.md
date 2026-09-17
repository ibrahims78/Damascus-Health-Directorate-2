# وصف معماري لمساري قاعدة البيانات

## الحدود

الواجهة React/Vite تتصل بـ Express عبر `/api`. طبقة Drizzle هي نقطة الوصول
الموحدة للمخطط، بينما يختلف المحرك حسب المسار:

```text
Desktop:
Web/Electron -> Express API -> Drizzle PGlite -> .damascus-data
                                      ^
                                      └── desktop-schema.sql

Hosted:
Web -> Express API -> Drizzle node-postgres -> PostgreSQL
                                      ^
                                      └── lib/db/migrations/
```

## دورة الإقلاع

1. يفرض API `SESSION_SECRET` في PostgreSQL.
2. ينتظر `databaseReady`.
3. في Desktop يطبق schema المرفق بطريقة idempotent.
4. في PostgreSQL يفحص الجداول والأعمدة وسجل migrations فقط؛ لا يطبق DDL.
5. بعد الجاهزية ينشئ هوية العقدة وبيانات التشغيل اللازمة.
6. يفتح المنفذ، ويعرض `/api/healthz` تفاصيل المسار وحالة قاعدة البيانات.

## مصدر الحقيقة

- تعريفات Drizzle: `lib/db/src/schema/`.
- migrations المستضافة: `lib/db/migrations/`.
- مخطط Desktop المعبأ: `lib/db/desktop-schema.sql`.
- عقد healthz: `lib/api-spec/openapi.yaml` وملفات Zod المولدة.

إذا تغيرت تعريفات schema، يجب توليد migration ومراجعتها ثم تشغيل readiness.
لا يكفي نجاح bundling لأن bundling لا يثبت توافق قاعدة البيانات.