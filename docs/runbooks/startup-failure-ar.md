# Runbook: فشل الإقلاع

## الأعراض

لا يفتح المنفذ، أو يظهر `database not ready`، أو يتوقف التطبيق بعد البناء.

## الإجراء

1. سجل `git rev-parse HEAD` والفرع والأمر والوقت.
2. افحص السجل دون نسخ أي secret:
   ```bash
   curl -fsS http://127.0.0.1:8080/api/healthz
   ```
3. تحقق من اختيار المسار: Desktop يحتاج `DAMASCUS_DESKTOP=1`، وPostgreSQL
   يحتاج `DATABASE_URL` و`SESSION_SECRET`.
4. في PostgreSQL نفذ `pnpm db:readiness` قبل إعادة تشغيل API.
5. لا تمسح `.damascus-data`؛ انسخه إلى مسار اختبار إذا احتجت العزل.
6. إذا فشل البناء، أعد `pnpm install --frozen-lockfile` ثم `pnpm build`.

## قرار التوقف

أوقف التشغيل ولا تعاود الكتابة إذا كان schema غير معروف، أو ظهرت أخطاء
migration، أو كان المنفذ مستخدمًا من عملية لا تعرف مالكها.
