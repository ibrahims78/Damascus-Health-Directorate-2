# Releases — حِزم التشغيل الجاهزة

حِزم التشغيل المبنية من المصدر، مرتّبة بحسب الإصدار.

## 4.3.0

### داخل هذا المجلد (GitHub)

| الملف | المنصّة | الوصف |
|---|---|---|
| `Damascus-Health-Directorate-v4.3.0-Android-Offline.apk` | Android | تطبيق عادي (بلا تفعيل) |
| `Damascus-Health-Directorate-v4.3.0-Android-Protected.apk` | Android | تطبيق محمي (يتطلب ترخيص 4.3.0) |
| `SHA256SUMS.txt` | — | بصمات ملفات أندرويد |
| `HOW-TO-REJOIN-4.3.0.txt` | — | خطوات دمج أجزاء حزم ويندوز |

### حِزم سطح المكتب (Windows) — مرفوعة كأجزاء

حزما ويندوز أكبر من حدّ GitHub للملف الواحد (100 ميجابايت)، لذلك رُفعتا على **44 جزءًا**
(8 ميجابايت لكل جزء) كمرفقات في صفحة الإصدار:

- Portable: `Damascus-Health-Directorate-4.3.0-Portable-Windows-x64.zip.p001 … p022`
- Protected: `Damascus-Health-Directorate-4.3.0-Protected-Windows-x64.zip.p001 … p022`

الدمج: نزّل أجزاء الحزمة في مجلد واحد ثم شغّل (PowerShell):

```powershell
$parts = Get-ChildItem "Damascus-Health-Directorate-4.3.0-Portable-Windows-x64.zip.p*" | Sort-Object Name
$out = [System.IO.File]::Create("Damascus-Health-Directorate-4.3.0-Portable-Windows-x64.zip")
foreach ($p in $parts) { $b=[System.IO.File]::ReadAllBytes($p.FullName); $out.Write($b,0,$b.Length) }
$out.Close()
```

أو ببساطة: `copy /b الحزمة.zip.p001+...+الحزمة.zip.p022 الحزمة.zip`

| الحزمة | الحجم | SHA-256 |
|---|---|---|
| Protected Windows | 168.8 MB | `7F6DBB8FC7DFA1B6F2CE8676D917AF3EE55EDEF5CB60388A5F3D2C6997F01613` |
| Portable Windows | 168.8 MB | `A39C8754FB5C4BEFC01A34D3CC88EA80C8861CBBA31C7EA68CA4CE0B60EC350` |
| Android | 15.1 MB | `969A44CDF35D00EF524A52A7319CFF3F918534A5169E8D7890E67FE06404E829` |

### مجموعة التفعيل

مجموعة التفعيل تحتوي **المفتاح الخاص** للتوقيع ⇒ **لا تُنشر علنًا** إطلاقًا، وتُسلَّم للجهة المالكة فقط.

## ملاحظات

- تطبيقات أندرويد موقّعة بمفتاح الإصدار الرسمي (v1+v2).
- النسخة المحمية تتطلب ترخيصًا بإصدار **4.3.0** مخصّصًا لمعرّف الجهاز؛ التراخيص القديمة (4.0.3) لا تُفعّل هذا الإصدار.
- لا يُشحن أي مجلد `data` مع الحزم.
