# Damascus Health Directorate — الإصدار 5.0.6

## نطاق الإصدار
نسخة مبنية بعد فرض قواعد تعدد المستودعات (تطبيق واحد بسلوك حسب النوع)، مع دمج وإصلاحات. الإصدار `5.0.6` و`versionCode 506`.

## الجديد في 5.0.6
- **قواعد المستودعات (مفروضة على الخادم):**
  - التحويل **مركزي→فرعي فقط** (`TRANSFER_NOT_ALLOWED`).
  - **مركزي واحد فقط** (`SINGLE_CENTRAL_ONLY`).
  - الفرع **لا ينشئ سند استلام من مورد** (`BRANCH_NO_SUPPLIER_RECEIPT`).
  - الفرع **لا يسجّل إدخالاً مباشراً** (`BRANCH_INBOUND_VIA_TRANSFER_ONLY`).
  - **إلزام سبب الفرق** في استلام التحويل (`VARIANCE_REASON_REQUIRED`).
- **واجهة حسب النوع:** عند مستودع فرعي تُخفى خيارات السند/إنشاء التحويل/الإرسال، ويبقى الاستلام والمرتجع المركزي.
- **توحيد أخطاء الحركات** في اعتماد الجرد (رمز/رسالة واضحة بدل 500).
- **تقرير جديد:** `GET /api/reports/inter-site` (مقارنة بين المواقع: تحويلات، كميات، فروق، متوسط زمن العبور).
- **المزامنة بين نسيّتين مُتحقّقة:** تصدير→استيراد (807 تغييرات، 0 تعارضات).

## الحزم
| الملف | المنصة | الوصف |
|---|---|---|
| `Damascus-Health-Directorate-5.0.6-Portable-Windows-x64.zip` | Windows 10/11 x64 | سطح مكتب عادي |
| `Damascus-Health-Directorate-5.0.6-Protected-Windows-x64.zip` | Windows 10/11 x64 | محمي بتفعيل Ed25519 |
| `Damascus-Health-Directorate-v5.0.6-Android-Offline.apk` | Android 7+ | أندرويد عادي |
| `Damascus-Health-Directorate-v5.0.6-Android-Protected.apk` | Android 7+ | أندرويد محمي |
| `Damascus-Health-Directorate-5.0.6-Activation-Kit.zip` | — | حزمة التفعيل 5.0.6 |

## البصمات (SHA-256)
| الملف | البصمة |
|---|---|
| Portable Windows zip | `6B991CD120D0277FC641B97ECED31CA05A554E3E5CBCE7684AA4D75E1762D2C1` |
| Protected Windows zip | `239905F2166321822F88073C07263B716E3EABA7E025F4BDACB7E48704305362` |
| Activation Kit zip | `615ECA9327D03D6145B81A7E599A588CC12A524958C6633AB6C1B39ACAC300BE` |
| Android Protected apk | `0C096BEC3F2F79C09F45A66354DC677A0D2C9D1E5207C085AED9294D71256F50` |
| Android Offline apk | `84122C03BDDC5A3CA6FAFEC34CADF96BF3927564A6486516A5B5A79B83A77F9A` |

## التوقيع
APKs موقّعة بمفتاح الإنتاج نفسه (شهادة `65b0cd24…`) → الأجهزة على 5.0.3/5.0.4/5.0.5 تقبل التحديث. versionCode 506.
