# Damascus Health Directorate — الإصدار 5.0.5

## نطاق الإصدار

نسخة مبنية من حالة المشروع بعد توحيد استيراد المواد والتجهيزات. الإصدار 5.0.5 وversionCode 505.

## الميزات والتغييرات

- **استيراد موحّد عبر «استيراد الكتالوج» (للمدير فقط):**
  - قالب التعريفات: المواد (بلا كميات) + التجهيزات (مع عمود كمية ومستودع إلزامي).
  - قالب الأرصدة الافتتاحية: لكل مستودع؛ كل صف يُنشئ حركة إدخال افتتاحية تظهر في تقرير «الرصيد حسب المستودع».
  - حد 2000 صف لكل عملية.
- **إزالة مداخل الاستيراد الثلاثة** من الواجهة (صفحة المواد، صفحة التجهيزات، تبويبا الإعدادات) والزر المضلّل في رأس الكتالوج.
- **إصلاح عطل سابق** في مسار «الأرصدة فقط» (لم يكن يجد معرّف مادة موجودة مسبقاً).
- **إصلاح بناء النسخ المحمية:** يُمرَّر `VITE_APP_VERSION` الآن من `package.json`، فتضمّن حزم الويب المحمية (Windows/Android) الإصدار `5.0.5` وترتبط بوابة التفعيل بالإصدار بدقة.

## الحزم

| الملف | المنصة | الوصف |
|---|---|---|
| `Damascus-Health-Directorate-5.0.5-Portable-Windows-x64.zip` | Windows 10/11 x64 | سطح مكتب عادي دون اتصال |
| `Damascus-Health-Directorate-5.0.5-Protected-Windows-x64.zip` | Windows 10/11 x64 | سطح مكتب محمي بتفعيل Ed25519 (تحقق على الخادم) |
| `Damascus-Health-Directorate-v5.0.5-Android-Offline.apk` | Android 7+ | نسخة Offline عادية |
| `Damascus-Health-Directorate-v5.0.5-Android-Protected.apk` | Android 7+ | نسخة محمية بتفعيل Ed25519 |
| `Damascus-Health-Directorate-5.0.5-Activation-Kit.zip` | — | حزمة التفعيل (مفاتيح + مولدات + تراخيص مثال 5.0.5) |

## التفعيل المحمي

- ترخيص Windows/Android مرتبط بالمنصة + معرّف الجهاز + إصدار التطبيق `5.0.5`.
- APKs موقّعة بمفتاح 5.0.3 نفسه (شهادة `65b0cd24…`)، فتقبل الأجهزة الحالية التحديث.
- لا توجد مفاتيح خاصة أو keystore ضمن المستودع أو أصول Release.
- استخدم `HOW-TO-REJOIN-5.0.5.txt` لإصدار ترخيص لجهاز جديد.

## التحقق

- `pnpm version:check` — ناجح (5.0.5 / versionCode 505).
- `pnpm typecheck` + البناء (api + web عادي/محمي) — ناجح.
- اختبارات الوحدة — ناجحة.
- APK: metadata (505/5.0.5) + توقيع v1/v2 + مطابقة شهادة 5.0.3 — متحقَّق.
- حزم الويب الأربع (public, protected-windows, protected-android, android-offline) تضمّ `5.0.5`.
- البصمات الكاملة في `RELEASE-SHA256SUMS-5.0.5.txt`.

## البصمات (SHA-256)

| الملف | البصمة |
|---|---|
| Damascus-Health-Directorate-5.0.5-Portable-Windows-x64.zip | `42CF511692683562E7EE884ED6A165F40BC80DF55362EE3209B6CA6A02E61D8C` |
| Damascus-Health-Directorate-5.0.5-Protected-Windows-x64.zip | `5C81FC8283DDA7F49CFEA604A1A22A034C23EE3C9E92889F04BE280E31A1C333` |
| Damascus-Health-Directorate-5.0.5-Activation-Kit.zip | `01CFA13CD93797000126CEEA434735288AD20A03F83FFAAC925B6D1E97802D7C` |
| Damascus-Health-Directorate-v5.0.5-Android-Protected.apk | `28C5B2F8E2E2664B878E526241ACC573D9239E9490ACBBB8E2AB704020F7DE48` |
| Damascus-Health-Directorate-v5.0.5-Android-Offline.apk | `A96F6AA725B97B05276A0A93878A915D1A742764B48B02CBE4A3D9CF0E24B7D9` |

## الحالة

لم يُرفع أي ملف إلى GitHub.
