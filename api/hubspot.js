/* =========================================================================
   HubSpot синк — CRM лидүүдийг HubSpot CRM руу дамжуулах proxy (Vercel)
   -------------------------------------------------------------------------
   Зөвхөн НЭВТЭРСЭН АДМИН дуудна. Хандалтыг браузерын Origin, хурдны хязгаар,
   болон админы Firebase ID token-оор гурвон давхар хамгаална.

   Нэвтрэлтийн мэдээлэл ЗААВАЛ орчны хувьсагчид (репо нээлттэй тул кодод бичихгүй):
     HUBSPOT_TOKEN            — HubSpot Private App-ийн token (crm.objects.contacts.write эрхтэй)
     HUBSPOT_STATUS_PROPERTY  — (сонголт) KPI төлөв бичих custom property-ийн дотоод нэр
                                (тохируулаагүй бол төлөв илгээхгүй)

   Ажиллагаа: admin.html →  POST /api/hubspot
     Headers: Authorization: Bearer <Firebase ID token>
     Body:    { "leads": [ { email, name, phone, org, role, status }, ... ] }
   ========================================================================= */
"use strict";

const PROJECT_ID = "kpiconsulting";
const HUBSPOT_BASE = "https://api.hubapi.com";
const FIRESTORE_BASE =
  "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
  "/databases/(default)/documents";
const BATCH_SIZE = 100; // HubSpot batch upsert-ийн дээд хязгаар

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Зөвхөн POST" });
    if (guard(req, res, 20, 60000)) return; // 1 минутанд 20 хүсэлт

    if (!process.env.HUBSPOT_TOKEN) {
      return sendJson(res, 500, { error: "Тохиргоо дутуу: HUBSPOT_TOKEN (Vercel env)" });
    }

    // ---- Зөвхөн админ: Firebase ID token-ыг Firestore-оор баталгаажуулна ----
    const token = bearer(req);
    if (!token) return sendJson(res, 401, { error: "Нэвтрэх шаардлагатай" });
    const uid = adminUidFromToken(token);
    if (!uid) return sendJson(res, 401, { error: "Токен буруу байна" });
    const isAdmin = await verifyAdmin(uid, token);
    if (!isAdmin) return sendJson(res, 403, { error: "Зөвхөн админ энэ үйлдлийг хийнэ" });

    // ---- Лидүүд ----
    const body = await readJson(req);
    const leads = Array.isArray(body && body.leads) ? body.leads : null;
    if (!leads) return sendJson(res, 400, { error: "leads массив дутуу" });
    if (leads.length > 5000) return sendJson(res, 400, { error: "Хэт олон лид (дээд тал 5000)" });

    // email-гүй лидийг HubSpot upsert-д ашиглаж болохгүй — алгасна
    const inputs = [];
    let skipped = 0;
    leads.forEach((l) => {
      const props = toProperties(l);
      if (!props) { skipped++; return; }
      inputs.push({ idProperty: "email", id: props.email, properties: props });
    });

    if (!inputs.length) {
      return sendJson(res, 200, { synced: 0, skipped: skipped, failed: 0, message: "И-мэйлтэй лид олдсонгүй" });
    }

    // ---- HubSpot руу багц багцаар upsert ----
    let synced = 0, failed = 0;
    const errors = [];
    const syncedEmails = []; // амжилттай илгээгдсэн и-мэйлүүд (клиент талд лог хөтлөхөд)
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
      const chunk = inputs.slice(i, i + BATCH_SIZE);
      const r = await fetch(HUBSPOT_BASE + "/crm/v3/objects/contacts/batch/upsert", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.HUBSPOT_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: chunk }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 200 || r.status === 201) {
        synced += (data.results && data.results.length) || chunk.length;
        chunk.forEach((c) => syncedEmails.push(c.id)); // c.id = и-мэйл (idProperty)
      } else if (r.status === 207) {
        // Хэсэгчилсэн амжилт — амжилттай/алдаатайг тусад нь тоолно
        const ok = (data.results && data.results.length) || 0;
        synced += ok;
        failed += chunk.length - ok;
        // Амжилттай мөрүүдийн и-мэйлийг үр дүнгээс салгана
        (data.results || []).forEach((rr) => {
          const em = rr && rr.properties && rr.properties.email;
          if (em) syncedEmails.push(String(em).toLowerCase());
        });
        if (data.message) errors.push(data.message);
      } else {
        failed += chunk.length;
        errors.push(hubspotError(r.status, data));
        // Токен/эрхийн алдаа бол цааш үргэлжлүүлэх нь утгагүй
        if (r.status === 401 || r.status === 403) break;
      }
    }

    return sendJson(res, 200, {
      synced: synced,
      skipped: skipped,
      failed: failed,
      syncedEmails: syncedEmails,
      errors: errors.slice(0, 5), // хэт урт болгохгүй
    });
  } catch (err) {
    const status = err.statusCode || 500;
    sendJson(res, status, {
      error: status === 500 && !err.statusCode ? "Серверийн алдаа" : err.message,
    });
  }
};

// ---- Лидийг HubSpot contact property болгох. email-гүй бол null. ----
function toProperties(lead) {
  const email = String((lead && lead.email) || "").trim().toLowerCase();
  if (!email || email.indexOf("@") === -1) return null;
  const props = { email: email };
  const set = (k, v) => { const s = String(v || "").trim(); if (s) props[k] = s; };
  set("firstname", lead.name);
  set("phone", lead.phone);
  set("company", lead.org);
  set("jobtitle", lead.role);
  // KPI төлөвийг зөвхөн тохируулсан custom property руу (эс бөгөөс HubSpot батчийг бүхэлд нь буцаана)
  const statusProp = process.env.HUBSPOT_STATUS_PROPERTY;
  if (statusProp) set(statusProp, lead.status);
  return props;
}

// ---- Firebase ID token-оос uid салгах (гарын үсэг Firestore талд шалгагдана) ----
function adminUidFromToken(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    // Зөвхөн энэ Firebase төслийн токен байх ёстой
    if (payload.aud !== PROJECT_ID) return null;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload.user_id || payload.sub || null;
  } catch (e) { return null; }
}

// ---- admins/<uid>-ийг тухайн хэрэглэгчийн токеноор уншиж чадвал → админ ----
// Firestore дүрэм (isAdmin) токеныг баталгаажуулж, зөвхөн жинхэнэ админд уншуулна.
async function verifyAdmin(uid, token) {
  try {
    const r = await fetch(FIRESTORE_BASE + "/admins/" + encodeURIComponent(uid), {
      headers: { Authorization: "Bearer " + token },
    });
    return r.status === 200;
  } catch (e) { return false; }
}

function hubspotError(status, data) {
  const msg = (data && (data.message || (data.errors && data.errors[0] && data.errors[0].message))) || "";
  return "HubSpot алдаа (" + status + ")" + (msg ? ": " + msg : "");
}

// ================= Нийтлэг туслахууд =================
function bearer(req) {
  const h = req.headers.authorization || "";
  return h.indexOf("Bearer ") === 0 ? h.slice(7).trim() : null;
}

function readJson(req) {
  if (req.body) {
    if (typeof req.body === "object") return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve(null); }
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "null")); } catch (e) { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

// Зөвхөн өөрийн сайтаас (хөтөч Origin-ыг хуурч чадахгүй)
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // хөтөч биш дуудлага — хурдны хязгаар шүүнэ
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  try {
    const h = new URL(origin).host;
    return h === host || h === "www." + host || "www." + h === host;
  } catch (e) { return false; }
}

const hits = new Map();
function rateLimited(req, limit, windowMs) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.reset) rec = { n: 0, reset: now + windowMs };
  rec.n++;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.forEach((v, k) => { if (now > v.reset) hits.delete(k); });
  return rec.n > limit;
}

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
