/* =========================================================================
   Цаг товлолтын мэдэгдэл — шинэ товлолт бүрт админуудад и-мэйл (Vercel)
   -------------------------------------------------------------------------
   Зочин index.html дээр цаг товлоход товлолт нь Firestore-ийн submissions-д
   бичигдэхийн зэрэгцээ энэ функц админуудад и-мэйл илгээнэ. Хариу нь
   захиалагч руу очдог (Reply-To) тул админ мэйлээсээ шууд хариулж болно.

   Тохиргоо — Vercel → Settings → Environment Variables (репо нээлттэй тул
   түлхүүр, хаягийг кодод бичихгүй):
     BOOKING_NOTIFY_TO    — хүлээн авагчид, таслалаар: "a@x.mn, b@y.mn"
     BOOKING_NOTIFY_FROM  — илгээгч: "KPI consulting <noreply@kpiconsulting.mn>"
                            (Resend-д заавал биш — өгөхгүй бол onboarding@resend.dev)
     Мэйл үйлчилгээний түлхүүрийн АЛЬ НЭГ нь:
       RESEND_API_KEY | SENDGRID_API_KEY | BREVO_API_KEY

   Замууд:
     GET  /api/notify-booking            → { configured, provider, recipients, missing }
                                           (хаягийг задруулахгүй — зөвхөн тоо)
     POST /api/notify-booking  {booking} → зочин товлоход. Origin + IP хязгаар.
     POST /api/notify-booking  {test:true} + Authorization: Bearer <админы ID token>
                                         → туршилтын мэйл (зөвхөн админ)
   ========================================================================= */
"use strict";

const PROJECT_ID = "kpiconsulting";
const FIRESTORE_BASE =
  "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";
const SITE = "KPI consulting";

// Зочин нэг товлолт хийхэд нэг дуудлага л хэрэгтэй. 10 минутанд 5 нь хангалттай
// бөгөөд админуудыг хуурамч товлолтоор спамдахаас сэргийлнэ.
const LIMIT = 5, WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();
// Давхар товшилт / дахин илгээлтээс нэг товлолт хоёр мэйл болохгүй.
const recent = new Map();
const DEDUPE_MS = 60 * 60 * 1000;

module.exports = async (req, res) => {
  try {
    const cfg = config();

    if (req.method === "GET") {
      return sendJson(res, 200, {
        configured: !cfg.missing.length,
        provider: cfg.provider || null,
        recipients: cfg.to.length,
        missing: cfg.missing,
      });
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Зөвхөн GET, POST" });
    if (!originAllowed(req)) return sendJson(res, 403, { error: "Зөвшөөрөгдөөгүй эх сурвалж" });

    const body = (await readJson(req)) || {};

    // ---- Туршилтын мэйл: зөвхөн нэвтэрсэн админ ----
    if (body.test === true) {
      const token = bearer(req);
      const uid = token && uidFromToken(token);
      if (!uid) return sendJson(res, 401, { error: "Эхлээд админаар нэвтэрнэ үү" });
      if (!(await verifyAdmin(uid, token))) return sendJson(res, 403, { error: "Зөвхөн админ" });
      if (cfg.missing.length) return sendJson(res, 503, { error: "Тохиргоо дутуу: " + cfg.missing.join(", ") });
      const now = new Date();
      const sample = {
        name: "Туршилтын хэрэглэгч", email: "", phone: "99112233", org: "Жишээ ХХК",
        date: ymd(now), time: "10:00", advisor: "Зөвлөх",
      };
      await deliver(cfg, compose(sample, siteBase(req), true));
      return sendJson(res, 200, { ok: true, recipients: cfg.to.length });
    }

    // ---- Зочны товлолт ----
    if (rateLimited(req)) return sendJson(res, 429, { error: "Хэт олон хүсэлт" });
    const b = cleanBooking(body);
    if (!b) return sendJson(res, 400, { error: "Товлолтын мэдээлэл буруу" });
    // Тохируулаагүй бол товлолт өөрөө амжилттай хэвээр — зүгээр л мэйл явахгүй.
    if (cfg.missing.length) return sendJson(res, 503, { error: "Мэдэгдэл тохируулаагүй" });

    const key = [b.email, b.phone, b.date, b.time, b.advisor].join("|").toLowerCase();
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < DEDUPE_MS) return sendJson(res, 200, { ok: true, dedup: true });
    recent.set(key, now);
    if (recent.size > 2000) recent.forEach((t, k) => { if (now - t > DEDUPE_MS) recent.delete(k); });

    try {
      await deliver(cfg, compose(b, siteBase(req), false));
    } catch (err) {
      recent.delete(key); // дахин оролдох боломжтой байг
      throw err;
    }
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("[notify-booking]", err && err.stack ? err.stack : err);
    return sendJson(res, 502, { error: "Мэйл илгээж чадсангүй: " + (err && err.message || "алдаа") });
  }
};

// ---------------------------------------------------------------------------
// Тохиргоо
// ---------------------------------------------------------------------------
function config() {
  const env = process.env;
  const to = String(env.BOOKING_NOTIFY_TO || "")
    .split(/[,;\s]+/).map(s => s.trim()).filter(s => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s));
  let provider = "", key = "";
  if (env.RESEND_API_KEY) { provider = "resend"; key = env.RESEND_API_KEY; }
  else if (env.SENDGRID_API_KEY) { provider = "sendgrid"; key = env.SENDGRID_API_KEY; }
  else if (env.BREVO_API_KEY) { provider = "brevo"; key = env.BREVO_API_KEY; }

  // Resend нь домэйн баталгаажуулаагүй үед onboarding@resend.dev-ээр илгээж
  // чаддаг (гэхдээ зөвхөн Resend бүртгэлийн эзний хаяг руу). SendGrid, Brevo
  // хоёр баталгаажсан илгээгч заавал шаарддаг.
  let from = String(env.BOOKING_NOTIFY_FROM || "").trim();
  if (!from && provider === "resend") from = SITE + " <onboarding@resend.dev>";

  const missing = [];
  if (!to.length) missing.push("BOOKING_NOTIFY_TO");
  if (!provider) missing.push("RESEND_API_KEY / SENDGRID_API_KEY / BREVO_API_KEY");
  if (provider && !from) missing.push("BOOKING_NOTIFY_FROM");
  return { to, provider, key, from: parseAddr(from), missing };
}

// "Нэр <a@b.mn>" эсвэл "a@b.mn" → { name, email }
function parseAddr(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || "");
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: "", email: String(s || "").trim() };
}

// ---------------------------------------------------------------------------
// Товлолтын өгөгдөл — firestore.rules-ийн хязгаартай ижил
// ---------------------------------------------------------------------------
function cleanBooking(x) {
  const s = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
  const b = {
    name: s(x.name, 120), email: s(x.email, 200), phone: s(x.phone, 40),
    org: s(x.org, 200), advisor: s(x.advisor, 120), date: s(x.date, 10), time: s(x.time, 5),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{1,2}:\d{2}$/.test(b.time)) return null;
  if (!b.name && !b.email && !b.phone) return null;
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) b.email = "";
  // Хуурамч/хэт хол огноог шүүнэ (өнөөдрөөс −2 … +400 хоног)
  const t = Date.parse(b.date + "T00:00:00Z");
  const days = (t - Date.now()) / 86400000;
  if (!isFinite(days) || days < -2 || days > 400) return null;
  return b;
}

// ---------------------------------------------------------------------------
// Мэйлийн агуулга
// ---------------------------------------------------------------------------
const WEEKDAYS = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

function compose(b, base, isTest) {
  const d = new Date(b.date + "T00:00:00Z");
  const when = b.date + " (" + WEEKDAYS[d.getUTCDay()] + ") · " + b.time;
  const subject = (isTest ? "[Туршилт] " : "") +
    "Шинэ цаг товлолт: " + (b.name || b.email || b.phone) + " — " + b.date + " " + b.time;
  const booked = new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());

  const rows = [
    ["Огноо, цаг", when],
    ["Зөвлөх", b.advisor],
    ["Нэр", b.name],
    ["И-мэйл", b.email, b.email && "mailto:" + b.email],
    ["Утас", b.phone, b.phone && "tel:" + b.phone.replace(/[^\d+]/g, "")],
    ["Байгууллага", b.org],
  ].filter(r => r[1]);

  const admin = base + "/admin";
  const text =
    (isTest ? "Энэ бол туршилтын мэйл — тохиргоо зөв ажиллаж байна.\n\n" : "") +
    "Шинэ цаг товлолт ирлээ.\n\n" +
    rows.map(r => r[0] + ": " + r[1]).join("\n") +
    "\n\nТовлосон: " + booked + " (Улаанбаатар)" +
    "\nАдмин самбар: " + admin +
    (b.email ? "\n\nЭнэ мэйлд хариу бичвэл шууд захиалагч руу очно." : "") + "\n";

  const tr = rows.map(r =>
    '<tr><td style="padding:10px 0;color:#6b7280;font-size:14px;width:130px;vertical-align:top">' + esc(r[0]) + "</td>" +
    '<td style="padding:10px 0;color:#111;font-size:15px;font-weight:600">' +
    (r[2] ? '<a href="' + esc(r[2]) + '" style="color:#15529c;text-decoration:none">' + esc(r[1]) + "</a>" : esc(r[1])) +
    "</td></tr>"
  ).join('<tr><td colspan="2" style="border-top:1px solid #eceef3;font-size:0;line-height:0">&nbsp;</td></tr>');

  const html =
    '<!doctype html><html lang="mn"><body style="margin:0;background:#f2f3f7;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f7;padding:28px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e3e5ec;border-radius:14px">' +
    '<tr><td style="padding:26px 28px 6px">' +
    (isTest ? '<div style="display:inline-block;background:#fff4e5;color:#9a5b00;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;margin-bottom:12px">ТУРШИЛТ — тохиргоо ажиллаж байна</div>' : "") +
    '<div style="font-size:12.5px;letter-spacing:.6px;text-transform:uppercase;color:#6b7280;font-weight:700">' + esc(SITE) + "</div>" +
    '<h1 style="margin:6px 0 4px;font-size:22px;color:#111">Шинэ цаг товлолт</h1>' +
    '<div style="font-size:15px;color:#444">' + esc(when) + "</div>" +
    "</td></tr>" +
    '<tr><td style="padding:14px 28px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + tr + "</table></td></tr>" +
    '<tr><td style="padding:18px 28px 26px">' +
    '<a href="' + esc(admin) + '" style="display:inline-block;background:#1b6fd0;color:#fff;text-decoration:none;font-weight:700;font-size:14.5px;padding:11px 22px;border-radius:999px">Админ самбарт харах</a>' +
    '<div style="margin-top:16px;font-size:12.5px;color:#6b7280">Товлосон: ' + esc(booked) + " (Улаанбаатар)" +
    (b.email ? "<br>Энэ мэйлд хариу бичвэл шууд захиалагч руу очно." : "") + "</div>" +
    "</td></tr></table></td></tr></table></body></html>";

  return { subject, text, html, replyTo: b.email || "" };
}

// ---------------------------------------------------------------------------
// Илгээх — үйлчилгээ бүрийн HTTP API (npm хамаарал шаардахгүй)
// ---------------------------------------------------------------------------
async function deliver(cfg, m) {
  let url, headers, payload;
  if (cfg.provider === "resend") {
    url = "https://api.resend.com/emails";
    headers = { Authorization: "Bearer " + cfg.key };
    payload = {
      from: cfg.from.name ? cfg.from.name + " <" + cfg.from.email + ">" : cfg.from.email,
      to: cfg.to, subject: m.subject, html: m.html, text: m.text,
    };
    if (m.replyTo) payload.reply_to = m.replyTo;
  } else if (cfg.provider === "sendgrid") {
    url = "https://api.sendgrid.com/v3/mail/send";
    headers = { Authorization: "Bearer " + cfg.key };
    payload = {
      personalizations: [{ to: cfg.to.map(email => ({ email })) }],
      from: cfg.from.name ? { email: cfg.from.email, name: cfg.from.name } : { email: cfg.from.email },
      subject: m.subject,
      content: [{ type: "text/plain", value: m.text }, { type: "text/html", value: m.html }],
    };
    if (m.replyTo) payload.reply_to = { email: m.replyTo };
  } else if (cfg.provider === "brevo") {
    url = "https://api.brevo.com/v3/smtp/email";
    headers = { "api-key": cfg.key };
    payload = {
      sender: cfg.from.name ? { email: cfg.from.email, name: cfg.from.name } : { email: cfg.from.email },
      to: cfg.to.map(email => ({ email })),
      subject: m.subject, htmlContent: m.html, textContent: m.text,
    };
    if (m.replyTo) payload.replyTo = { email: m.replyTo };
  } else {
    throw new Error("мэйл үйлчилгээ тохируулаагүй");
  }

  const r = await fetch(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, headers),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.text()).slice(0, 300); } catch (e) {}
    throw new Error(cfg.provider + " " + r.status + (detail ? " — " + detail : ""));
  }
}

// ---------------------------------------------------------------------------
// Туслахууд (api/hubspot.js-тэй ижил загвар)
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function siteBase(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "www.kpiconsulting.mn";
  const proto = req.headers["x-forwarded-proto"] || (/^localhost|^127\./.test(host) ? "http" : "https");
  return proto + "://" + host;
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // хөтөч биш дуудлага — IP хязгаар шүүнэ
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  try {
    const h = new URL(origin).host;
    return h === host || h === "www." + host || "www." + h === host;
  } catch (e) { return false; }
}
function rateLimited(req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.reset) rec = { n: 0, reset: now + WINDOW_MS };
  rec.n++;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.forEach((v, k) => { if (now > v.reset) hits.delete(k); });
  return rec.n > LIMIT;
}
function bearer(req) {
  const h = req.headers.authorization || "";
  return h.indexOf("Bearer ") === 0 ? h.slice(7).trim() : null;
}
function uidFromToken(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (p.aud !== PROJECT_ID) return null;
    if (p.exp && Date.now() / 1000 > p.exp) return null;
    return p.user_id || p.sub || null;
  } catch (e) { return null; }
}
// Токены гарын үсгийг Firestore өөрөө шалгана: admins/{uid}-г тэр токеноор
// уншиж чадвал л жинхэнэ админ (дүрэм: зөвхөн админ унших).
async function verifyAdmin(uid, token) {
  try {
    const r = await fetch(FIRESTORE_BASE + "/admins/" + encodeURIComponent(uid), {
      headers: { Authorization: "Bearer " + token },
    });
    return r.status === 200;
  } catch (e) { return false; }
}
function readJson(req) {
  if (req.body) {
    if (typeof req.body === "object") return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve(null); }
  }
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 2e4) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "null")); } catch (e) { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
