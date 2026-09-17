# دليل الإصدار وإعادة الإنتاج

## مصدر النسخة

النسخة الرسمية النشطة مصدرها `package.json` في الجذر. لا تعدل `versionCode`
أو نسخة الواجهة أو Android يدويًا؛ استخدم:

```bash
pnpm version:check
pnpm version:sync
```

تُحوّل النسخة `major.minor.patch` حتميًا إلى
`versionCode = major * 100 + minor * 10 + patch`.

## قائمة الإصدار

```bash
pnpm install --frozen-lockfile
pnpm security:scan
pnpm docs:check
pnpm version:check
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm test:e2e
pnpm release:dry-run
```

يُحفظ ناتج `release-dry-run` مع commit واسم الفرع وSHA256 لكل مخرج. لا تُرفع
الأسرار أو مفاتيح التوقيع أو حزم البناء الكبيرة إلى Git؛ تُنشر عبر Release
مع ملاحظات الإصدار وchecksum.

## الإصدار الحالي

- المستودع: `https://github.com/ibrahims78/Damascus-Health-Directorate-2`
- الفرع: `main`
- المصدر: `package.json`
- الملاحظات: `CHANGELOG.md`

## فشل الإصدار

لا تتجاوز فشل typecheck أو الاختبار أو فحص الأمن أو اختلاف النسخة. أصلح السبب
أو سجّل استثناءً محددًا بمالك وموعد انتهاء قبل إعادة المحاولة.