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
| `firestore.rules` | Аюулгүй байдлын дүрэм |

## Өгөгдлийн загвар (Firestore)

- `content/*` — нийтийн контент. Хэн ч унших, зөвхөн админ засах.
- `submissions/*` — зочны хүсэлт/захиалга/бүртгэл. Зочид зөвхөн үүсгэх, зөвхөн админ унших.
- `public/taken_slots` — захиалагдсан цаг (PII биш).
- `admins/*` — админы UID жагсаалт.

## Deploy

Статик сайт — Vercel дээр build шаардлагагүй. `main` салбар руу push хийхэд
автоматаар deploy хийгдэнэ.

Firebase тохиргооны дэлгэрэнгүйг [`SETUP-firebase.md`](SETUP-firebase.md)-ээс үзнэ үү.
