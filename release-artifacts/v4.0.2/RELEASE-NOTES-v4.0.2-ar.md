# ملاحظات الإصدار 4.0.2 — تحديث الهوية البصرية والحزم المحمولة

## التحديثات

- استبدال الشعار الرئيسي بشعار **مديرية صحة دمشق / Damascus Health Directorate** المرفق والمعتمد.
- توحيد الشعار في شاشة الدخول، الشريط الجانبي، صفحات الخطأ، التقارير المطبوعة وسندات العمليات.
- تحديث favicon وأيقونة الويب وأيقونات التشغيل وشاشة البدء لنسخة Android.
- تحديث شعار نافذة نسخة Windows المعبأة.
- توحيد إصدار التطبيق إلى `4.0.2` و`versionCode=402`.
- بناء نسخ Android عادية ومحمية ونسخ Windows عادية ومحمية من نفس مصدر `master`.

## الملفات

- `Damascus-Emergency-Inventory-v4.0.2-Android-Offline.apk`
- `Damascus-Emergency-Inventory-v4.0.2-Android-Protected.apk`
- `Damascus-Emergency-Inventory-v4.0.2-Windows-Offline.zip`
- `Damascus-Emergency-Inventory-v4.0.2-Windows-Protected.zip`
- `SHA256SUMS` لكل منصة

## التحقق المنفذ

- `pnpm run typecheck` ناجح.
- 46 اختبارًا ناجحًا.
- توقيع APK محقق على Android v1 وv2، مع بصمة توقيع موحدة للنسختين.
- APK يحمل `versionCode=402` و`versionName=4.0.2` و`compileSdk=35`.
- محتوى الويب داخل APK يطابق مخرجات المشروع؛ ملفات Capacitor runtime الإضافية متوقعة.
- محتوى الويب داخل `app.asar` يطابق مخرجات المشروع للنسختين العادية والمحمية.
- المفتاح العام الصحيح مضمّن في Android Protected وفي حزمة Windows Protected.
- مولدا تراخيص Windows وAndroid أنشآ تراخيص اختبار موقعة، وتم التحقق منها بالمفتاح العام للمنصة.
- خادم API المعبأ وواجهة الملفات الثابتة اجتازا فحص health محليًا عندما شُغّلت الحزمة.

## ملاحظات مهمة

- سكربت Android يقرأ keystore وكلمات المرور من `DAMASCUS_RELEASE_SECRETS_DIR` ومتغيرات البيئة، ولا يضمّن أسرارًا في Git.
- مولدات التفعيل أدوات داخلية للمشغّل فقط؛ لا تُنشر معها المفاتيح الخاصة.
- اختبار تشغيل Windows الأصلي يحتاج جهاز Windows فعليًا، واختبار APK التفاعلي يحتاج جهازًا أو محاكي Android. تم هنا التحقق من إعادة التجميع، التوقيع، محتوى الحزمة، وخادم API.