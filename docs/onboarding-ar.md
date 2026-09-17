# دليل الانضمام والتشغيل — مستودعات مديرية صحة دمشق

**الغرض:** تمكين مسؤول أو مطور جديد من بناء النظام وتشغيله وتشخيصه دون معرفة
شفوية.  
**النطاق:** نسخة التطوير المحلية، Desktop/PGlite، PostgreSQL، Android، الاختبار
والمزامنة. لا يستخدم هذا الدليل بيانات إنتاج.

## 1. المتطلبات

- Node.js 20 أو أحدث.
- pnpm `10.26.1` كما يحدد `package.json`.
- Git.
- JDK 21 وAndroid SDK عند بناء Android.
- PostgreSQL عند اختبار مسار الاستضافة.
- مساحة كافية لبيانات PGlite وملفات البناء المؤقتة.

تحقق من النسخ:

```bash
node --version
pnpm --version
git --version
java -version
```

## 2. إنشاء نسخة عمل

```bash
git clone --branch main --single-branch \
  https://github.com/ibrahims78/Damascus-Health-Directorate-2.git
cd Damascus-Health-Directorate-2
pnpm install --frozen-lockfile --ignore-scripts
```

لا تضع `DATABASE_URL` أو `SESSION_SECRET` أو مفاتيح التوقيع في Git. تستخدم
Secrets أو مدير البيئة، وتبقى كلمات مرور حزم المزامنة خارج الملفات.

## 3. البوابات الأساسية

نفذ الأوامر من الجذر وبالترتيب:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm test:e2e
pnpm docs:check
pnpm version:check
```

عند الحاجة إلى اختبار المزامنة وحده:

```bash
pnpm sync:phase6
pnpm sync:performance
```

## 4. تشغيل Desktop/PGlite

شغل Workflow `Start application` في Replit، أو نفذ:

```bash
export DAMASCUS_DESKTOP=1
export DAMASCUS_SCHEMA_PATH="$PWD/lib/db/desktop-schema.sql"
export DAMASCUS_DATA_DIR="$PWD/.damascus-data"
export NODE_ENV=development
pnpm --filter @workspace/api-server run build
PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs
```

في طرفية أخرى:

```bash
PORT=5000 pnpm --filter @workspace/web run dev
```

تحقق من:

```bash
curl -fsS http://127.0.0.1:8080/api/healthz
```

في أول تشغيل تظهر شاشة إنشاء حساب المدير. لا يوجد حساب افتراضي. لا تمسح
`.damascus-data` إلا بعد أخذ نسخة اختبارية أو بتفويض مسؤول البيانات.

## 5. تشغيل PostgreSQL

اضبط `DATABASE_URL` و`SESSION_SECRET` في البيئة الآمنة، ثم:

```bash
pnpm db:migrate
pnpm db:readiness
pnpm --filter @workspace/api-server run dev
```

لا يبدأ API المستضاف بمخطط ناقص. إذا فشل readiness، اقرأ الرسالة ونفذ migration
المطلوبة؛ لا تستخدم `drizzle-kit push-force` كحل سريع.

## 6. بناء Android

ابنِ الواجهة أولًا ثم حدّث مشروع Capacitor:

```bash
pnpm build:web
npx cap sync android
./android/gradlew assembleDebug
```

لا تختبر APK محميًا بمفتاح توقيع تطوير على أنه إصدار إنتاج. راجع
`docs/key-management-ar.md` قبل أي توقيع.

## 7. النسخ والمزامنة

للتبادل اليدوي: صدّر `.dme-sync` من شاشة المزامنة، انقل الملف عبر قناة آمنة،
ثم افحصه واستورده في الجهة الأخرى. استخدم كلمة مرور مستقلة للحزمة، ولا ترسلها
في نفس القناة مع الملف.

للتبادل الشبكي: استخدم الاقتران أولًا، ثم نفذ المزامنة من عقدة موثوقة فقط.
راجع `sync-state-machine-ar.md` قبل تشخيص حالة عالقة.

## 8. عند الفشل

1. سجل commit والفرع والوقت والأمر الكامل.
2. احفظ آخر 200 سطر من سجل العملية دون أسرار.
3. حدد هل الفشل في التثبيت، النوع، البناء، قاعدة البيانات، النقل، أو التطبيق.
4. لا تعاود المحاولة على قاعدة بيانات مشتركة قبل معرفة هل العملية idempotent.
5. استخدم runbook المناسب تحت `docs/runbooks/`.

## 9. اختبار نقل المعرفة

يجب أن ينفذ الشخص الثاني خطوات البناء، تشغيل Desktop، readiness، اختبار
المزامنة، أخذ نسخة اختبارية، تشخيص عطل مصطنع، ثم rollback دون مساعدة مباشرة.
يسجل المراجع النتيجة في `knowledge-transfer-report-ar.md`.
