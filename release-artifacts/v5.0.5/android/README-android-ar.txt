Damascus Health Directorate — حزم Android v5.0.5

- Offline: نسخة عادية دون تفعيل.
- Protected: نسخة محمية بتفعيل Ed25519 مرتبط بمعرّف الجهاز ومنصة Android وإصدار التطبيق 5.0.5.
- versionCode 505 · versionName 5.0.5.

التوقيع:
- موقّعة بمفتاح إصدار Android نفسه المستخدم في 5.0.3/5.0.4
  (شهادة SHA-256: 65b0cd242d610aa2d72502dff7cd42e7167313e5835087cb28fcc587743069cf)،
  لذلك تقبل الأجهزة المثبَّت عليها 5.0.3/5.0.4 التحديث.
- مخططات التوقيع: v1 (JAR) + v2 (APK Signature Scheme v2) — متحقَّق منها.

البناء (أُجري محلياً بالتوليفة في offline-build-tools):
- JDK 21 + Android SDK (platform 35, build-tools 34) + Gradle 8.11.1.
- cap sync ثم gradlew assembleRelease مع التوقيع من release-secrets.
