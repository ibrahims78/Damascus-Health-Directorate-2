# دليل التطوير التقني — مستودعات مديرية صحة دمشق

> هذا الدليل لمن يريد البناء من المصدر أو المساهمة. للاستخدام اليومي راجع [README.md](README.md) وصفحة [الإصدارات](https://github.com/ibrahims78/Damascus-Health-Directorate-2/releases).

## البيئة

- **Node.js 20+** و **pnpm 9+** (على ويندوز: `pnpm install --ignore-scripts` لتجاوز سكربت preinstall الذي يفترض bash)
- بناء أندرويد الكامل يحتاج Android SDK وJDK 21 مع Capacitor 7 (`android/gradlew assembleRelease`)
- بناء حزم سطح المكتب يُدار من خلال خطوات الإصدار الموثقة في `docs/release-runbook-ar.md`

## المنافذ

| السياق | الواجهة | API |
|---|---|---|
| حزم الإصدار (سطح المكتب) | **41790** ثابت (0.0.0.0) | **41789** ثابت |
| تطوير (`start-dev.ps1`) | 22333 | 8080 (`PORT` env) |

> سكربتات التطوير تشغّل API بواجهة PGlite مدمجة (`DAMASCUS_DESKTOP=1`) دون PostgreSQL خارجي.

## البناء من المصدر

```bash
pnpm install --ignore-scripts
pnpm run typecheck            # كل الحزم (lib ثم artifacts)
pnpm run build                # بناء كامل (API + واجهة)

# النسخة المحمية (ويب)
node scripts/build-protected-web.mjs windows    # أو android (يشتق الإصدار من package.json)
pnpm --filter @workspace/api-server run build:protected

# بناء APK (Offline + Protected) بالتوليفة والمفتاح المحليين
.\Build-Android-Apk.ps1

# تجميع حزمة ويندوز (يحتاج runtime Electron + main-template)
.\release-artifacts\scripts\reassemble-electron.ps1
```

> **التوليفة المحلية في هذه النسخة:** `offline-build-tools/` (JDK 21 + Android SDK + Gradle + Electron runtime + pnpm store)، ومفتاح التوقيع في `release-secrets/android/`، وحزمة التفعيل في `deliverables/`. راجع `BUILD-AND-TOOLS-AR.md`.

**مهم**: عند تعديل `lib/api-spec/openapi.yaml` نفّذ codegen ثم `tsc --build` قبل typecheck (حزم lib تعتمد على مخرجات TS المترجمة).

## الملفات الحرجة (لا تعدل بلا فهم)

| الملف | الدور |
|---|---|
| `lib/db/desktop-schema.sql` | مخطط قاعدة الحزم — **ترتيب العبارات حساس** (ALTER بعد CREATE) + ترميم ذاتي مطابق في `lib/db/src/index.ts` |
| `lib/license-core/src/index.ts` | تحقق الترخيص (WebCrypto + noble الاحتياطي) — مشترك بين الويب والخادم |
| `scripts/release-dry-run.mjs` | تحقق الإصدار ومخرجات البناء وchecksums قبل النشر |
| `lib/api-client-react/` + `lib/api-zod/` | مولدة من OpenAPI — **لا تعدل يدوياً** |

## الاختبارات

- `docs/tests/` — اختبارات API الشاملة (مزامنة، أمان، استعادة) تعمل على مثيلين حيين. **غير مضمّنة في هذه النسخة المحلية** (مقصودة: لا ملفات اختبار).
- `.github/workflows/ci.yml` و`scripts/ci-e2e.sh` — CI يبني ويشغّل الاختبارات. **غير مضمّنة هنا**.
- Vitest (`pnpm test`) — قواعد الجرد والحركة. `vitest.config.ts` غير مضمّن هنا.

## هيكل المستودع

```
artifacts/          web (React) + api-server (Express)
lib/                db, license-core, backup-format, api-spec, api-client-react, api-zod, sync-contract
android/            مشروع أندرويد (Capacitor)
scripts/            البناء، إصدار التراخيص، الاستيراد
release-artifacts/  ملاحظات الإصدار + سكربتات تجميع ويندوز + مفاتيح التحقق
release-secrets/    مفتاح توقيع الإنتاج (keystore) — سري
offline-build-tools/  التوليفة المحلية (JDK 21 + Android SDK + Gradle + Electron + pnpm store)
deliverables/       حزم ويندوز وأندرويد + حزمة التفعيل + البصمات
```

## ملاحظات ويندوز الحرجة (دروس مستفادة)

1. سكربتات PowerShell عربية → **UTF-8 with BOM** إجباري (PS 5.1 يفسد ما عداه)
2. `Invoke-RestMethod` في PS 5.1 يرسل النصوص Latin-1 → للـ API عربي استخدم Node أو UTF-8 bytes صريحة
3. `pnpm dlx @electron/asar` يكتب ضجيجاً في stderr → لفّها بـ `cmd /c "... >nul 2>&1"` تحت `$ErrorActionPreference='Stop'`
4. روابط GitHub للأصول الكبيرة (>100MB) لا ترفع في git — استخدم Releases

---

## الإصدار 5.0.5

يحتوي هذا الإصدار مراحل التطوير الكاملة: الحاكمية والصلاحيات · الكتالوج والوحدات المعيارية ·
حاكمية الاستيراد · مركز المخزون والترصيد · نموذج المستودعات · دورة التحويل · إدارة المزامنة ·
التقارير الموحّدة والطباعة، إضافةً إلى **توحيد استيراد المواد والتجهيزات** واستيراد **الأرصدة الافتتاحية لكل مستودع**.

- الدليل التفصيلي: `README.md` (والملاحظات في `CHANGELOG.md`)
