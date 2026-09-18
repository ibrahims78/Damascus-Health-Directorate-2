# Damascus Health Directorate — الإصدار 5.0.4

## نطاق الإصدار

هذه نسخة إنتاجية مبنية من آخر حالة على الفرع `main` بعد إغلاق بوابات الجاهزية
والتشغيل والاستعادة. تشمل الحزمة إصلاحات وتحديثات تقييم المخزون بتكلفة FIFO/COGS،
تحسينات فحوص الجاهزية، توثيق التشغيل والاستعادة، وإصلاحات مسار النسخ المحمية
والتفعيل الموجودة في `main`.

## الحزم

| الملف | المنصة | الوصف |
|---|---|---|
| `Damascus-Health-Directorate-5.0.4-Portable-Windows-x64.zip` | Windows 10/11 x64 | نسخة سطح مكتب عادية تعمل دون اتصال |
| `Damascus-Health-Directorate-5.0.4-Protected-Windows-x64.zip` | Windows 10/11 x64 | نسخة سطح مكتب محمية بتفعيل Ed25519 |
| `Damascus-Health-Directorate-v5.0.4-Android-Offline.apk` | Android 7+ | نسخة Offline عادية |
| `Damascus-Health-Directorate-v5.0.4-Android-Protected.apk` | Android 7+ | نسخة محمية بتفعيل Ed25519 |

تمت مزامنة رقم النسخة إلى `5.0.4` ورقم Android إلى `versionCode 504`.
تم توقيع APKs بمفتاح إصدار Android نفسه المستخدم في `5.0.3`، وتحقق البناء من
تطابق بصمة شهادة التوقيع حتى تقبل الأجهزة التحديث.

## التفعيل المحمي

- نسخة Windows المحمية تستخدم مفتاح ترخيص Windows العام.
- نسخة Android المحمية تستخدم مفتاح ترخيص Android العام.
- الترخيص مربوط بالمنصة ومعرّف الجهاز ورقم التطبيق `5.0.4`.
- لا توجد مفاتيح خاصة أو كلمات مرور أو keystore ضمن المستودع أو أصول Release.
- استخدم `HOW-TO-REJOIN-5.0.4.txt` لإصدار ترخيص لجهاز جديد.

## التحقق

- `pnpm version:check` — ناجح.
- `pnpm typecheck` — ناجح.
- `pnpm build` — ناجح؛ بقيت تحذيرات sourcemap وحجم chunk غير الحاجبة.
- فحص APK metadata والتوقيع — ناجح.
- فحص ZIP — ناجح.
- البصمات الكاملة موجودة في `RELEASE-SHA256SUMS-5.0.4.txt`.