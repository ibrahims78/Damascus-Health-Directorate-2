# Releases

هذا المجلد يحمل **تعريفات الإصدار** وملفَّي تطبيق أندرويد (كل ملف ~8 ميجابايت، داخل حد git).

## من أين تُنزَّل الحزم الكاملة؟
من صفحة الإصدارات (Release assets) — تسمح حتى 2 جيجابايت للملف، بلا تجزيء:

- **4.3.0 (استيراد الكتالوج)**: `v4.3.0-catalog-import`
  https://github.com/ibrahims78/Damascus-Health-Directorate-2/releases/tag/v4.3.0-catalog-import
  - Portable Windows ZIP (158.7 MB)
  - Protected Windows ZIP (158.7 MB)
  - Android Offline APK + Android Protected APK
  - RELEASE-SHA256SUMS-4.3.0.txt

## لماذا لا تُخزَّن حزم ويندوز داخل المستودع؟
لأن git على GitHub يرفض أي ملف أكبر من **100 ميجابايت**، وقاعدة ذلك تسري على أي مجلد داخل
المستودع — بما في ذلك مجلد اسمه `Releases`. أما مرفقات الإصدارات (Release assets) فحدّها
**2 جيجابايت للملف الواحد**، وهي المكان الصحيح للحزم الكاملة.

## محتوى `Releases/4.3.0/`
| الملف | الوصف |
|---|---|
| `Damascus-Health-Directorate-v4.3.0-Android-Offline.apk` | تطبيق أندرويد (أوفلاين) |
| `Damascus-Health-Directorate-v4.3.0-Android-Protected.apk` | تطبيق أندرويد محمي (تفعيل 4.3.0) |
| `HOW-TO-REJOIN-4.3.0.txt` | طريقة التنزيل والتحقّق والتشغيل |
| `SHA256SUMS.txt` | بصمات كل الحزم |
