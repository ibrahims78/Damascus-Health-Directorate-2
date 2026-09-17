# دليل تشغيل قاعدة البيانات

## قاعدة القرار

يوجد مساران رسميان لا يجوز خلطهما:

| المسار | مصدر المخطط | طريقة التطبيق | يحتاج `DATABASE_URL` |
|---|---|---|---|
| Desktop/PGlite | `lib/db/desktop-schema.sql` | عند إقلاع API بوضع Desktop، بشكل idempotent | لا |
| PostgreSQL | `lib/db/migrations/*.sql` | أمر migration مستقل قبل API | نعم |

لا يطبق API PostgreSQL migrations تلقائياً. هذا يمنع أن تنفذ عدة نسخ من
الخادم DDL متزامناً أو أن تتغير القاعدة دون سجل نشر.

## إنشاء أو تهيئة PostgreSQL جديدة

احفظ `DATABASE_URL` و`SESSION_SECRET` في Secrets، ثم نفذ:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:readiness
```

ينشئ `db:migrate` سجل Drizzle ويطبق كل ملفات
`lib/db/migrations/` بالترتيب. الأمر قابل لإعادة التشغيل؛ تشغيله مرة ثانية
لا يعيد تطبيق migrations المعروفة.

## فحص الجاهزية

```bash
pnpm db:readiness
```

الفحص لا يعدل البيانات. يتحقق من:

1. الاتصال واسم قاعدة البيانات والمخطط.
2. الجداول التي يحتاجها API، بما فيها المخزون والمستودعات والتحويلات
   والجرد والاستلام والمزامنة والنسخ.
3. الأعمدة الحرجة للتوافق الخلفي.
4. وجود `drizzle.__drizzle_migrations`.
5. عدد migrations وآخر migration مطبق.

`status=ready` شرط تشغيل. عند الفشل يظهر سبب قابل للتنفيذ وأمر
`pnpm --filter @workspace/db run db:migrate`.

## التحقق من API

بعد نجاح readiness:

```bash
PORT=8080 NODE_ENV=production node artifacts/api-server/dist/index.mjs
curl -fsS http://127.0.0.1:8080/api/healthz
```

يتطلب PostgreSQL `SESSION_SECRET` حتى في `NODE_ENV=development`. لا يستخدم
الخادم secret افتراضياً خارج Desktop. يعرض healthz `database.status=ready`
و`mode=postgres` و`schemaSource=postgres-migrations`.

## migration فاشلة

1. أوقف API المتأثر.
2. احتفظ بسجل الأمر والخطأ ورقم migration.
3. تحقق من حالة سجل Drizzle عبر `pnpm db:readiness`.
4. راجع SQL قبل إعادة المحاولة.
5. لا تستخدم `push-force` على قاعدة تشغيلية.
6. إذا كان التغيير الكبير قد بدأ، خذ نسخة احتياطية واتبع خطة التعويض
   المعتمدة؛ لا تحذف جداول أو تعيد إنشاء schema يدوياً.

الـ migrations الحالية additive. أي migration جديدة يجب أن تكون forward-only
أو أن توثق تعويضاً واضحاً قبل الدمج.

## Desktop data directory

```bash
DAMASCUS_DESKTOP=1 \
DAMASCUS_SCHEMA_PATH="$PWD/lib/db/desktop-schema.sql" \
DAMASCUS_DATA_DIR="$PWD/.damascus-data" \
PORT=8080 \
node artifacts/api-server/dist/index.mjs
```

لا تضع `DATABASE_URL` في هذا المسار ولا تستخدم بيانات إنتاجية في الاختبارات.
اختبر data directory جديداً وقديماً قبل اعتماد تغيير مشترك في schema.