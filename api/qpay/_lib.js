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

module.exports = { qpayFetch, sendJson, sendError };
