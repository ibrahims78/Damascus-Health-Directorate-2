# مصفوفة قبول المزامنة — المرحلة السادسة

**البيئة الأساسية:** نسختان API مستقلتان، PGlite مؤقت، بيانات صناعية، Node 20
وpnpm lockfile.  
**الأمر:** `pnpm sync:phase6` أو `pnpm test:e2e`.

| المجال | السيناريو | الدليل المتوقع | الاختبار |
|---|---|---|---|
| الهوية | عقدتان جديدتان | `nodeId` مختلف | api-sync 1–2 |
| capture | إنشاء/تعديل/حذف | change + outbox | api-sync 3, 10–11 |
| vectors | delta بعد متجه سابق | لا `SYNC_SEQUENCE_GAP` | api-sync 9 |
| idempotency | إعادة نفس الحزمة | duplicate ولا مضاعفة رصيد | api-sync 8 |
| ordering | حزمة خارج الترتيب | رفض واضح | contract + service |
| payload | operationId بحمولة مختلفة | conflict مسجل | api-sync 7 |
| references | حركة قبل مرجعها | conflict أو ترتيب pass آمن | api-sync 5–6 |
| tombstone | حذف ناعم ينتشر | الطرف الآخر inactive/غائب | api-sync 11 |
| movement | واردة وحركة معدات | الكمية والحركة تتقاربان | api-sync 5–6 |
| conflict | تعديل مقابل تعديل | قرار approve/reject/correct | api-sync 7 |
| security | توقيع/كلمة خاطئة | رفض دون تسريب | api-security/offline |
| integrity | تعديل bytes | checksum/MAC failure | backup-format |
| interruption | إعادة الإرسال بعد الانقطاع | استئناف دون duplicate | الجلسة/الحزمة |
| restart | إعادة تشغيل أثناء التطبيق | حالة durable معروفة | ci-e2e |
| performance | أحجام S/M/L | زمن وحجم وذاكرة مسجلة | sync-performance |

## حالات يجب تشغيلها قبل G3

- تعديل مقابل تعديل لنفس الكيان.
- حذف مقابل تعديل.
- نفس الاسم أو الرمز مع قيد فريد.
- تحويل/حركة متزامنة.
- تعارض هوية عقدة أو مفتاح غير موثوق.
- حزمة مكررة وناقصة ومعدلة وموقعة بمفتاح خاطئ.
- إيقاف العملية بعد حفظ الحزمة وقبل الإقرار.
- اختلاف إصدار العقدتين مع رفض `formatVersion` غير المدعوم.

## قاعدة الفشل

أي فقد صامت، تضاعف رصيد، تعارض غير قابل للتفسير، أو نجاح ظاهري بعد MAC/توقيع
غير صالح يمنع اعتماد G3 ويُسجل كـ P0/P1 حسب الأثر.
