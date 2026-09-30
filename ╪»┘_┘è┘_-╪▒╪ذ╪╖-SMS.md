# دليل ربط التحقق برسائل SMS (SMSGate) مع WTS Pay

## اللي اتعمل

أصبح تسجيل أي محفظة جديدة **مستحيل بدون إثبات ملكية رقم الهاتف** برسالة SMS:

1. المستخدم يدخل رقمه بالصيغة الدولية (`+2010xxxxxxxx`) → يضغط "إرسال كود التحقق".
2. السيرفر يولّد كود 6 أرقام ويبعته SMS عن طريق **موبايل الأندرويد بتاعك** (SMSGate).
3. المستخدم يدخل الكود → السيرفر يتحقق ويصدر `phoneToken` صالح 15 دقيقة.
4. `/api/auth/register` يرفض أي طلب بدون `phoneToken` مطابق للرقم.

### حمايات مدمجة
- الكود متخزّن **كـ hash فقط** (SHA-256) — مش نص صريح أبدًا.
- صلاحية الكود 5 دقائق، و5 محاولات إدخال كحد أقصى.
- 45 ثانية بين كل إرسال، وحد أقصى 5 رسائل يوميًا لكل رقم.
- لو الرقم مسجل قبل كده، مش هيتبعتله SMS أصلاً.
- لا migration مطلوب — التخزين في جدول `Config` الموجود.

---

## لماذا SMSGate وليس SmsKit؟

SMSGate مفتوح المصدر ومجاني، وسيرفره تقدر تستضيفه بنفسك (Docker)، والـ API بتاعه موثّق. SmsKit تطبيق تجاري مغلق محتاج سيرفر خاص بيهم.

## خطوات التشغيل

### 1) جهّز الموبايل
- ثبّت تطبيق **SMSGate** على موبايل أندرويد فيه شريحة فعالة (رصيد SMS).
- ادخل حسابك في التطبيق (Cloud mode) أو اربطه بسيرفرك الخاص.
- من إعدادات التطبيق ← **بيانات الاعتماد**: اضبط **اسم المستخدم** و**كلمة المرور** (اللي حاليًا "لم يحدد" في صورتك).

> ⚠️ وضع "الخادم المحلي" (Local Server) **لن يعمل** مع Cloudflare Worker — لازم Cloud mode أو سيرفر خاص على الإنترنت.

### 2) (اختياري لكن مُستحسن) سيرفر خاص بدل السحابي
السحابي المجاني له حدود يومية. لسيرفر خاص على أي VPS:
```bash
docker run -d -p 8080:8080 --name smsgate capcom6/android-sms-gateway:latest
```
وفي التطبيق: الإعدادات ← رابط API ← `http://IP-السيرفر:8080` (أو دومين + HTTPS).

### 3) أضف الـ Secrets في Cloudflare
من لوحة التحكم (نفس شاشة الصورة بتاعتك) أو بـ wrangler:
```bash
cd server
npx wrangler secret put SMSGATE_USERNAME   # اسم المستخدم من التطبيق
npx wrangler secret put SMSGATE_PASSWORD   # كلمة المرور من التطبيق
# لو سيرفر خاص فقط:
npx wrangler secret put SMSGATE_URL        # مثال: https://sms.yourdomain.com/3rdparty/v1
```
لو مش هتحدد `SMSGATE_URL` هيستخدم الافتراضي: `https://api.sms-gate.app/3rdparty/v1`

### 4) انشر
```bash
cd server && npm run deploy        # الـ Worker
cd ../client && npm run build      # الواجهة على Pages
```

### 5) اختبر
افتح صفحة التسجيل → أدخل رقمك الحقيقي → المفروض توصلك رسالة:
> `WTS Pay: Your verification code is 123456. It expires in 5 minutes. Never share it with anyone.`

## ملفات جديدة/معدّلة
| ملف | التغيير |
|---|---|
| `server/src/services/sms.service.ts` | **جديد** — عميل SMSGate API |
| `server/src/services/otp.service.ts` | **جديد** — دورة حياة OTP + phoneToken |
| `server/src/controllers/otp.controller.ts` | **جديد** |
| `server/src/routes/auth.routes.ts` | إضافة `/api/auth/otp/request` و `/api/auth/otp/verify` |
| `server/src/controllers/auth.controller.ts` | التسجيل يتطلب `phoneToken` |
| `server/src/config.ts` | إعدادات `smsGate` |
| `server/src/middleware/errorHandler.ts` | معالجة أخطاء OTP/SMS |
| `server/tests/otp.test.ts` | **جديد** — 9 اختبارات |
| `client/src/pages/Register.tsx` | تسجيل على 3 خطوات مع الكود |
| `client/src/services/api.ts` + `useAuth.tsx` | دوال OTP + تمرير phoneToken |

## ملاحظات
- الموبايل لازم يفضل شغال ومتصل بالنت ومعاه رصيد رسائل — قفل أي "تحسين بطارية" على التطبيق.
- كل رسالة SMS بتتخصم من رصيد شريحتك (تكلفة رسالة محلية/دولية حسب الرقم).
- الحدود (5 دقائق، 5 محاولات، 45 ثانية، 5 رسائل/يوم) قابلة للتعديل في أعلى `otp.service.ts`.
