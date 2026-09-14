# Release notes 4.0.3 — Damascus Health Directorate packages

## التحديثات

- استبدال الشعار الرئيسي بشعار **مديرية صحة دمشق / Damascus Health Directorate** المرفق والمعتمد.
- توحيد الشعار في شاشة الدخول، الشريط الجانبي، صفحات الخطأ، التقارير المطبوعة وسندات العمليات.
- تحديث favicon وأيقونة الويب وأيقونات التشغيل وشاشة البدء لنسخة Android.
- تحديث شعار نافذة نسخة Windows المعبأة.
- إعادة تسمية حزم Windows وAndroid إلى **Damascus Health Directorate**.
- توحيد إصدار التطبيق إلى `4.0.3` و`versionCode=403`.
- تصحيح اسم ملف ومجلد Windows التنفيذي مع إبقاء معرّف Android التقني القديم للتوافق مع التحديثات.
- استخدام ملف ICO الرسمي لشعار مديرية صحة دمشق في نافذة Windows.
- تصحيح مولدات التفعيل وإعادة إصدار تراخيص Android وWindows لتطابق `appVersion=4.0.3`.
- بناء نسخ Android عادية ومحمية ونسخ Windows عادية ومحمية من نفس مصدر `master`.

## الملفات

- `Damascus-Health-Directorate-v4.0.3-Android-Offline.apk`
- `Damascus-Health-Directorate-v4.0.3-Android-Protected.apk`
- `Damascus-Health-Directorate-v4.0.3-Windows-Offline.zip`
- `Damascus-Health-Directorate-v4.0.3-Windows-Protected.zip`
- `SHA256SUMS` لكل منصة

## التحقق المنفذ

- `pnpm run typecheck` ناجح.
- 46 اختبارًا ناجحًا.
- توقيع APK محقق على Android v1 وv2، مع بصمة توقيع موحدة للنسختين.
- APK يحمل `versionCode=403` و`versionName=4.0.3` و`compileSdk=35`.
- محتوى الويب داخل APK يطابق مخرجات المشروع؛ ملفات Capacitor runtime الإضافية متوقعة.
- محتوى الويب داخل `app.asar` يطابق مخرجات المشروع للنسختين العادية والمحمية.
- المفتاح العام الصحيح مضمّن في Android Protected وفي حزمة Windows Protected.
- مولدا تراخيص Windows وAndroid أنشآ تراخيص اختبار موقعة، وتم التحقق منها بالمفتاح العام للمنصة.
- خادم API المعبأ وواجهة الملفات الثابتة اجتازا فحص health محليًا عندما شُغّلت الحزمة.

## ملاحظات مهمة

- سكربت Android يقرأ keystore وكلمات المرور من `DAMASCUS_RELEASE_SECRETS_DIR` ومتغيرات البيئة، ولا يضمّن أسرارًا في Git.
- مولدات التفعيل أدوات داخلية للمشغّل فقط؛ لا تُنشر معها المفاتيح الخاصة.
- تم اختبار مولد التفعيل محليًا والتحقق من التوقيع، المنصة، معرّف الجهاز، وإصدار الترخيص.
- اختبار التشغيل التفاعلي النهائي يحتاج جهاز Windows فعليًا وجهازًا أو محاكي Android؛ تم هنا التحقق من إعادة التجميع، التوقيع، محتوى الحزمة، وملفات التفعيل.