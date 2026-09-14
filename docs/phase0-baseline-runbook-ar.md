# دليل تشغيل خط أساس المواد والدفعات

## النطاق

هذا الدليل يغطي المرحلة 0 واختبار ترحيل المرحلة 2 فقط. لا ينفذ قارئ Excel
المهني أو الاستيراد الذري أو تغييرات واجهة المرحلة 3.

## حماية بيانات التطوير

قبل أي ترحيل، أنشئ نسخة من بيانات PGlite المحلية واحفظ بصمتها:

```bash
mkdir -p .local/phase0-backups
tar -czf .local/phase0-backups/dev-data-<timestamp>.tar.gz .damascus-data
sha256sum .local/phase0-backups/dev-data-<timestamp>.tar.gz
```

في تنفيذ 2026-09-10 كانت النسخة:

- المسار: `.local/phase0-backups/dev-data-20260909T200954Z.tar.gz`
- البصمة: `59ce5a1a7f5c0f616cf32152b2c276984d416cbde1b5238571c534e62ef4769f`
- نقطة الكود: `c983f347231592442cdd108153487a1054997c1b`

لا تُرفع هذه النسخة إلى Git. للاستعادة في مجلد اختبار جديد:

```bash
rm -rf /tmp/dme-restore-test
mkdir -p /tmp/dme-restore-test
tar -xzf .local/phase0-backups/dev-data-20260909T200954Z.tar.gz -C /tmp/dme-restore-test
```

لا تحذف `.damascus-data` التشغيلية ولا تستبدلها قبل إيقاف التطبيق والتحقق من
البصمة. الاستعادة التشغيلية تتطلب مراجعة منفصلة.

## Fixtures والفحوص

```bash
pnpm run phase0:fixtures
pnpm test lib/db/src/phase2-migration.test.ts
pnpm run build
env -u DATABASE_URL pnpm run phase0:baseline
```

السكربت الأخير:

1. يرفض أي بيئة تحتوي `DATABASE_URL`.
2. ينشئ PGlite مؤقتًا ويزرع مستخدمًا اختباريًا محليًا.
3. يفحص health، إنشاء مادة، إدخال دفعة، تفاصيلها، وFEFO.
4. يقرأ ملف مادة اصطناعيًا ويرسله لمسار الاستيراد الحالي.
5. ينشئ حزمة `full-backup` ويفحص manifest، ثم ينفذ dry-run واستعادة merge
   وتراجعًا فعليًا داخل قاعدة الاختبار.
6. يتحقق من بقاء الدفعة بعد الاستعادة والتراجع، مع تخطي حسابات المستخدمين
   عمدًا وفق سياسة النسخ الحالية.
7. يحذف مجلد الاختبار حتى عند الفشل.

## سياسة الخصوصية والتوافق

الـfixtures اصطناعية، ولا تحتوي أسماء أو أرقام أو ملاحظات تشغيلية. الحقول
القديمة `items.expiryDate` و`items.batchNumber` و`items.supplier` تبقى للقراءة
والتوافق، ولا تُستخدم كمصدر FEFO. الدفعة هي مصدر الصلاحية والرقم والمورد
والمرجع. لا يطبق هذا الدليل سياسة استيراد Excel الجديدة؛ تلك ضمن مرحلة لاحقة.