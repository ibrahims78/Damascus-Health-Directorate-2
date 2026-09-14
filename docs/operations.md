# دليل التشغيل والنشر

## متطلبات التشغيل

- Node.js 20 أو أحدث و`pnpm 9+`.
- PostgreSQL مع `DATABASE_URL` عند استخدام وضع الاستضافة؛ أما Workflow المحلي
  الحالي فيستخدم PGlite داخل `.damascus-data`.
- `SESSION_SECRET` محفوظ في Secrets، ولا يوضع في ملفات المشروع.
- تشغيل التطبيق من خلال Workflow الرئيسي `Start application`؛ هذا الـWorkflow
  يشغّل API على 8080 والواجهة على 5000 معًا في بيئة سطح المكتب المحلية.

## تشغيل بيئة التطوير

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
pnpm run typecheck
pnpm run build
```

للتشغيل اليدوي:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/web run dev
```

يجب أن يستمع API على `PORT` (8080 في إعدادات ريبليت الحالية)، وتبقى طلبات
الواجهة نسبية إلى `/api` حتى تعمل من خلال المعاينة أو النشر.

## النشر

1. شغّل `pnpm run typecheck` و`pnpm run build`.
2. شغّل `pnpm test` و`pnpm run acceptance:inventory` و`pnpm run phase0:baseline`
   بعد إزالة `DATABASE_URL` من جلسة الاختبار.
3. راجع إعدادات `DATABASE_URL` و`SESSION_SECRET` في بيئة النشر.
4. نفّذ نشر ريبليت من نقطة تحقق ناجحة.
5. بعد النشر تحقّق من `GET /api/healthz` ومن تسجيل الدخول والتقارير.

لا تعتبر المعاينة المحلية بديلاً عن اعتماد مسؤول المستودع لقواعد الرصيد
والبيانات التشغيلية قبل فتح النظام للمستخدمين.

## النسخ الاحتياطي والاستعادة

النسخ الاحتياطي والاستعادة المعياريان محميان بدور `admin`:

- `GET /api/backup/info` يعرض أعداد السجلات.
- `POST /api/backups/export` مع `{"password":"..."}` ينزّل ملف
  `.dme-sync` مضغوطاً ومشفراً بـ`AES-256-GCM` ومحمياً بـ`HMAC-SHA-256`.
- `POST /api/backups/inspect` يفك الحزمة للتحقق ويعرض الـManifest دون تعديل القاعدة.
- `POST /api/backups/dry-run` مع `mode` يطبق الفحص البنيوي والمنطقي ويصدر
  `previewToken` صالحاً 15 دقيقة.
- `POST /api/backups/restore` يتطلب نفس الحزمة وكلمة المرور و`previewToken` و
  `confirm=true`؛ يدعم `mode: "merge"` و`mode: "full"`.
- `GET /api/backups/:restorePointId/report` يعرض تقرير الاستعادة.
- `POST /api/backups/:restorePointId/rollback` مع `confirm=true` يعيد نقطة ما قبل
  الاستعادة داخل معاملة كاملة.
- `GET /api/backups` يعرض كتالوج النسخ المتاحة وبيانات سياسة الاحتفاظ دون كشف
  محتوى الحزم المشفرة.
- `POST /api/backups` ينشئ نسخة `full-backup` أو `delta-sync` ويحفظ بياناتها
  المشفرة في الكتالوج، مع `retentionClass` اختيارية (`manual` أو `daily` أو
  `weekly` أو `monthly`).
- `GET /api/backups/:backupId/package` ينزّل حزمة من الكتالوج، و
  `POST /api/backups/:backupId/verify` يفحص كلمة المرور والبصمة دون تعديل
  البيانات التشغيلية.
- `GET/PUT /api/backups/policy` لإدارة حدود الاحتفاظ، و
  `POST /api/backups/retention/enforce` لتطبيقها يدوياً.

تستبعد الحزمة كلمات مرور المستخدمين والجلسات والأسرار، ولا تستعيد حسابات المستخدمين؛
تبقى حسابات البيئة الحالية. استخدم كلمة مرور حزمة مستقلة، واحفظها خارج الملف.
لا تعتمد `full` على الإنتاج قبل مراجعة المعاينة واختبار الحزمة في قاعدة اختبار.

يبقى `GET /api/backup/export` و`POST /api/backup/restore` للتوافق مع الصيغة القديمة
فقط؛ لا تستخدمهما لإنشاء حزم جديدة. الصيغة الجديدة هي المرجع التشغيلي.

## التراجع

للتراجع عن إصدار منشور، استخدم Checkpoints/نسخة النشر السابقة في ريبليت،
ثم راجع توافق مخطط قاعدة البيانات. لا تستبدل مخطط PostgreSQL يدوياً ولا تطبق
نسخة احتياطية على الإنتاج دون موافقة مسؤول البيانات؛ الاستعادة عملية merge
بـ`onConflictDoNothing` وليست حذفاً شاملاً.

## مؤشرات الفشل والتدقيق

- فشل الحركة يعيد HTTP بخطأ واضح ويسجل `movement_failed` بعد التراجع.
- نجاح الحركة يسجل `movement_created`.
- تصدير واستعادة النسخة يسجلان `backup_export` و`backup_restore`.
- سجل التدقيق للمدير فقط، وهو للقراءة والتصدير ولا يعدل السجلات السابقة.
- تسجل العمليات الجديدة `backup_package_export` و`backup_package_restore` و
  `backup_restore_rollback` مع بصمة الحزمة والنتيجة دون حفظ كلمة المرور.

## اختبارات الصيانة

الاختبارات المتوفرة في النسخة الحالية هي `pnpm test` و`pnpm run typecheck`
و`pnpm lint`. أما اختبارات المراحل القديمة التي كانت تعتمد على ملفات تشغيلية
خارج المستودع فلم تعد أوامر مدعومة، حتى لا تشير وثائق التشغيل إلى ملفات غير
موجودة.

## بوابة قبول استيراد المواد والدفعات

نفذ الأوامر التالية من جذر المشروع:

```bash
pnpm test
pnpm run typecheck
pnpm run build
pnpm run acceptance:inventory
env -u DATABASE_URL PHASE0_PORT=8091 pnpm run phase0:baseline
E2E_PORT_A=8181 E2E_PORT_B=8182 E2E_FRESH_PORT=8183 bash scripts/ci-e2e.sh
```

تستخدم الاختبارات بيانات اصطناعية ومنافذ معزولة. لا تشغل خادم API مستقلًا على
`8080` بالتوازي مع `Start application`؛ الـworkflow الرئيسي هو الذي يشغّل API
والواجهة معًا. افتح نموذج Excel يدويًا في برامج المكتب الفعلية قبل اعتماد
البيانات التشغيلية.

## اختبارات بوابة المواد والدفعات — المراحل 0 و1 و2

تولّد fixtures المرحلة 0 بيانات اصطناعية فقط:

```bash
pnpm run phase0:fixtures
pnpm test lib/db/src/phase2-migration.test.ts
pnpm run build
env -u DATABASE_URL pnpm run phase0:baseline
```

يرفض `phase0:baseline` العمل عند وجود `DATABASE_URL`، ويشغّل API على قاعدة
PGlite مؤقتة ثم يحذفها. لا تستخدمه ضد `.damascus-data` أو أي قاعدة مستضافة.
نسخة بيانات التطوير قبل الترحيل تحفظ محليًا في `.local/phase0-backups/` ولا
تُرفع إلى المستودع.

## تشغيل المرحلة 6 — النسخ الكامل والتفاضلي

الجدولة في خادم الويب اختيارية ومغلقة افتراضياً. لتفعيلها في بيئة التشغيل، احفظ
`BACKUP_SCHEDULER_PASSWORD` في Secrets (لا تضعها في الملفات)، ثم اضبط:

```text
BACKUP_SCHEDULER_ENABLED=1
BACKUP_SCHEDULE_INTERVAL_MS=86400000
```

ينشئ التشغيل الأول Full Backup، ثم ينشئ Delta Backup من `lastVector` لآخر نسخة
متاحة. لا يحتفظ الخادم بكلمة المرور داخل الكتالوج؛ يخزن الحزمة المشفرة فقط.
عند فشل النسخة أو امتلاء التخزين تبقى النسخ السابقة ولا تعتبر العملية ناجحة.

التحقق الحالي من وظائف النسخ يتم عبر اختبارات المشروع العامة:

```bash
pnpm test
pnpm run acceptance:inventory
env -u DATABASE_URL pnpm run phase0:baseline
```

أما اختبار المرحلة القديم فلم يعد ضمن ملفات المستودع الحالية. يغطي التشغيل
وجود تغييرات معلقة، Full ثم Delta، تطبيق Delta بعد خط الأساس،
فحص البصمة، وسياسة الاحتفاظ مع حماية آخر Full Backup سليم. تصدير الحزمة إلى
مسار يختاره المستخدم في Windows أو Android يبقى مسؤولية محول المنصة الذي يستهلك
ملف `.dme-sync`؛ واجهة Web تعيد الملف كـdownload ولا تكتب إلى جهاز العميل.
