/* =========================================================================
   QPay v2 — нийтлэг туслахууд (Vercel serverless функцуудад)
   -------------------------------------------------------------------------
   Нэвтрэлтийн мэдээлэл нь ЗААВАЛ орчны хувьсагчид байна (репо нээлттэй тул
   кодод бичихийг хориглоно):
     QPAY_USERNAME      — client_id
     QPAY_PASSWORD      — client_secret
     QPAY_INVOICE_CODE  — qPay-ээс олгосон нэхэмжлэлийн код
     QPAY_AMOUNT        — гишүүнчлэлийн үнэ (₮, заяамал 99000)

   Токеныг warm instance доторх санах ойд кэшилж, хугацаа нь дуусахаас
   1 минутын өмнө л шинээр авна — QPay-ийн "нэг хугацаанд нэг л удаа
   token авах" шаардлагыг хангана.
   ========================================================================= */
"use strict";

const QPAY_BASE = "https://merchant.qpay.mn/v2";

let cachedToken = { token: null, exp: 0 };

function requireEnv() {
  const missing = ["QPAY_USERNAME", "QPAY_PASSWORD", "QPAY_INVOICE_CODE"]
    .filter((k) => !process.env[k]);
  if (missing.length) {
    const err = new Error("Тохиргоо дутуу: " + missing.join(", ") + " (Vercel env)");
    err.statusCode = 500;
    throw err;
  }
}

async function getToken() {
  if (cachedToken.token && Date.now() < cachedToken.exp - 60000) {
    return cachedToken.token;
  }
  const basic = Buffer.from(
    process.env.QPAY_USERNAME + ":" + process.env.QPAY_PASSWORD
  ).toString("base64");
  const r = await fetch(QPAY_BASE + "/auth/token", {
    method: "POST",
    headers: { Authorization: "Basic " + basic },
  });
  if (!r.ok) {
    const err = new Error("QPay нэвтрэлт амжилтгүй (" + r.status + ")");
    err.statusCode = 502;
    throw err;
  }
  const d = await r.json();
  // expires_in нь unix timestamp (сек) эсвэл үргэлжлэх сек аль нь ч байж болно
  const e = Number(d.expires_in || 0);
  cachedToken = {
    token: d.access_token,
    exp: e > 1e9 ? e * 1000 : Date.now() + (e || 3600) * 1000,
  };
  return cachedToken.token;
}

async function qpayFetch(path, options) {
  requireEnv();
  let token = await getToken();
  let r = await doFetch();
  if (r.status === 401) {
    // Кэшлэгдсэн токен хүчингүй болсон — нэг л удаа шинээр аваад давтана
    cachedToken = { token: null, exp: 0 };
    token = await getToken();
    r = await doFetch();
  }
  return r;

  function doFetch() {
    return fetch(QPAY_BASE + path, {
      method: (options && options.method) || "GET",
      headers: Object.assign(
        { Authorization: "Bearer " + token },
        options && options.body ? { "Content-Type": "application/json" } : {}
      ),
      body: options && options.body ? JSON.stringify(options.body) : undefined,
    });
  }
}

// ---- Зөвхөн өөрийн сайтаас дуудагдана ----
// Хөтөч Origin толгойг хуурч чадахгүй тул энэ нь бусад сайтаас
// нэхэмжлэл үүсгэхийг зогсооно. (curl-ийг зогсоохгүй — түүнд хурдны
// хязгаар хариуцна.)
function originAllowed(req) {
  var origin = req.headers.origin;
  if (!origin) return true; // хөтөч биш дуудлага — хурдны хязгаар шүүнэ
  var host = req.headers["x-forwarded-host"] || req.headers.host || "";
  try {
    var h = new URL(origin).host;
    return h === host || h === "www." + host || "www." + h === host;
  } catch (e) { return false; }
}

// ---- Энгийн хурдны хязгаар ----
// Warm instance доторх санах ойд хадгална. Vercel олон instance ажиллуулж
// болох тул энэ нь үнэмлэхүй биш — автомат хэрэгслээр мянгаар нь нэхэмжлэл
// үүсгэхийг удаашруулах зорилготой.
var hits = new Map();
function rateLimited(req, limit, windowMs) {
  var ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  var now = Date.now();
  var rec = hits.get(ip);
  if (!rec || now > rec.reset) { rec = { n: 0, reset: now + windowMs }; }
  rec.n++;
  hits.set(ip, rec);
  if (hits.size > 5000) { // санах ой хэт өсөхөөс сэргийлж хугацаа нь дууссаныг цэвэрлэнэ
    hits.forEach(function (v, k) { if (now > v.reset) hits.delete(k); });
  }
  return rec.n > limit;
}

// Хамгаалалтын шалгалтуудыг нэг дор. Дамжвал null, эс бөгөөс хариу бичээд true.
function guard(req, res, limit, windowMs) {
  if (!originAllowed(req)) { sendJson(res, 403, { error: "Зөвшөөрөгдөөгүй эх сурвалж" }); return true; }
  if (rateLimited(req, limit, windowMs)) { sendJson(res, 429, { error: "Хэт олон хүсэлт. Хэсэг хүлээнэ үү." }); return true; }
  return false;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function sendError(res, err) {
  // Дотоод алдааны дэлгэрэнгүйг (токен, нууц үг гэх мэт) хэрэглэгчид задлахгүй
  const status = err.statusCode || 500;
  sendJson(res, status, {
    error: status === 500 && !err.statusCode ? "Серверийн алдаа" : err.message,
  });
}

module.exports = { qpayFetch, sendJson, sendError, guard };
