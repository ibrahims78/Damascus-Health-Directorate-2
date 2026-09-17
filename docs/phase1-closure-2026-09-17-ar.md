# تقرير إغلاق المرحلة 1: إصلاح CI وأدوات البناء وإعادة الإنتاج

## النطاق

- الهدف: توحيد أوامر النوع والبناء والاختبار وlint وE2E من الجذر.
- الفرع: `main`
- commit التنفيذ: يسجل في commit الذي يضم هذا التقرير.
- المالك: قائد التطوير
- المراجع: يحدد قبل اعتماد G1
- التاريخ: 17 أيلول 2026

## التغييرات

- إضافة scripts جذرية: `typecheck`, `build`, `test`, `lint`, `test:e2e`.
- تثبيت `pnpm@10.26.1` في `package.json` وتشغيل install بوضع frozen.
- ترتيب TypeScript: libraries أولاً مع `tsc -b --force` ثم API والواجهة
  والسكريبتات وعقود backup/sync.
- إضافة lint dependencies وتغيير CI من informational إلى hard gate.
- إضافة `docs/ci-guide-ar.md`.
- تحديث Vitest من `3.2.4` إلى `5.0.1` بعد رفض تنزيل النسخة القديمة من
  جدار الحزم؛ لم يتم تعطيل الجدار.

## الاختبارات

| الأمر/السيناريو | البيئة | النتيجة | السجل |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | Replit, pnpm 10.26.1 | PASS | سجل جلسة التنفيذ |
| `pnpm typecheck` | Node.js 20.20.0 | PASS | جميع المجموعات |
| `pnpm build` | Node.js 20.20.0 | PASS | API وWeb؛ تحذير حجم chunks |
| `pnpm test` | Vitest 5.0.1 | PASS | 11 ملفات، 59 اختباراً |
| `pnpm lint` | ESLint 10.10.0 | PASS | 0 أخطاء، 444 تحذيراً معلناً |
| `pnpm test:e2e` | Desktop/PGlite | PASS | 51 مزامنة، 13 أمان، 8 كلمات مرور |

## التوثيق المحدث

- `replit.md`
- `README.md` أو تعليمات الجذر ذات الصلة
- `.github/workflows/ci.yml`
- `docs/ci-guide-ar.md`

## المخاطر المفتوحة

- تحذيرات lint legacy ما زالت كثيرة، لكنها لا تتجاوز أخطاء lint.
- تحذيرات Vite لحجم chunks ما زالت خارج نطاق المرحلتين 1 و2.
- يلزم تشغيل CI على GitHub بعد الدفع للتحقق من بيئة Node.js 22.

## القرار

- [ ] اعتماد
- [x] اعتماد مع استثناءات موثقة
- [ ] طلب تعديل
- [ ] إيقاف

## توقيع الاعتماد

- صاحب المشروع:
- المراجع:
- التاريخ: