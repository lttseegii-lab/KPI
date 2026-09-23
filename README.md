# KPI consulting

KPI хэмжилт, удирдлагын зөвлөх үйлчилгээний вэбсайт. Статик HTML сайт бөгөөд
Firebase (Firestore + Authentication) backend-тэй.

## Бүтэц

| Файл | Тайлбар |
|------|---------|
| `index.html` | Нийтийн вэбсайт (нийтлэл, темплэйт, үнийн санал, цаг захиалга) |
| `kpi360.html` | KPI360 Masterclass кампанит ажлын landing page (`/kpi360`) |
| `admin.html` | Админ удирдлага (Firebase Auth нэвтрэлт) |
| `firebase.js` | Firestore + Auth нийтлэг давхарга (`KPICloud`) |
| `analytics.js` | Хуудас үзэлтийн хэмжилт (Firestore REST, SDK шаардахгүй) |
| `api/share.js` | Нийтлэлийн бие даасан indexable хуудас (`/a/<id>`) — SEO |
| `api/sitemap.js` | Динамик `sitemap.xml` (бүх нийтлэлийг оруулна) |
| `api/notify-booking.js` | Шинэ цаг товлолт бүрт админуудад и-мэйл мэдэгдэл |
| `firestore.rules` | Аюулгүй байдлын дүрэм |

## Өгөгдлийн загвар (Firestore)

- `content/*` — нийтийн контент. Хэн ч унших, зөвхөн админ засах.
- `submissions/*` — зочны хүсэлт/захиалга/бүртгэл. Зочид зөвхөн үүсгэх, зөвхөн админ унших.
- `public/taken_slots` — захиалагдсан цаг (PII биш).
- `analytics/*` — өдөр тутмын хуудас үзэлтийн тоолуур (PII биш). Хэн ч өсгөх,
  зөвхөн админ унших. Тайланг админы «Тайлан» хэсгээс харна.
- `admins/*` — админы UID жагсаалт.

## Орчны хувьсагч (Vercel → Settings → Environment Variables)

Репо нээлттэй тул түлхүүр, хаягийг кодод бичихгүй.

| Хувьсагч | Зориулалт |
|----------|-----------|
| `BOOKING_NOTIFY_TO` | Цаг товлолтын мэдэгдэл хүлээн авах хаягууд, таслалаар: `a@x.mn, b@y.mn` |
| `BOOKING_NOTIFY_FROM` | Илгээгч: `KPI consulting <noreply@kpiconsulting.mn>`. Resend-д заавал биш |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` / `BREVO_API_KEY` | Мэйл үйлчилгээний түлхүүр — аль нэг нь |
| `HUBSPOT_TOKEN` | Админы CRM → HubSpot синк |
| `QPAY_USERNAME`, `QPAY_PASSWORD`, `QPAY_INVOICE_CODE` | QPay төлбөр |

Мэдэгдлийн төлөв болон туршилтын мэйлийг админ → Тохиргоо → «Цаг товлох цонхны
текст» хэсгээс шалгана.

## Deploy

Статик сайт — Vercel дээр build шаардлагагүй. `main` салбар руу push хийхэд
автоматаар deploy хийгдэнэ.

Firebase тохиргооны дэлгэрэнгүйг [`SETUP-firebase.md`](SETUP-firebase.md)-ээс үзнэ үү.
