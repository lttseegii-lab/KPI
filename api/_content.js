/* =========================================================================
   Нийтлэлийн контентыг сервер талд Firestore-оос уншина (нийтэд нээлттэй).
   -------------------------------------------------------------------------
   /api/share ба /api/og-image функцүүд хуваалцах OG таг болон нийтлэлийн
   зургийг гаргахад ашиглана. Контент нь content/kpihub_articles баримтын
   'json' талбарт JSON тэмдэгт мөр хэлбэрээр хадгалагдсан (нэвтрэлт шаардахгүй,
   дүрэм: хэн ч унших). API түлхүүр нь нийтийн (клиентэд аль хэдийн ил).
   ========================================================================= */
"use strict";

const PROJECT = process.env.FIREBASE_PROJECT_ID || "kpiconsulting";
const API_KEY =
  process.env.FIREBASE_API_KEY || "AIzaSyBvjR_5pAAksA4UcQeRyzt6bEL1yk717Pw";
function docUrl(key) {
  return (
    "https://firestore.googleapis.com/v1/projects/" +
    PROJECT +
    "/databases/(default)/documents/content/" +
    encodeURIComponent(key) +
    "?key=" +
    API_KEY
  );
}
// Нийтлэлүүд нь Firestore-ийн 1MB баримтын хязгаараас болж хэд хэдэн хэсэгт
// хуваагдан хадгалагддаг (index.html, admin.html-тэй ижил түлхүүрүүд).
// Зөвхөн эхний хэсгийг уншвал сүүлийн хэсэг дэх нийтлэлүүд «олдсонгүй» болж,
// хуваалцахад нийтлэлийн биш, сайтын брэнд зураг гарч байв.
const ART_SHARD_KEYS = [
  "kpihub_articles", "kpihub_articles_2", "kpihub_articles_3", "kpihub_articles_4",
  "kpihub_articles_5", "kpihub_articles_6", "kpihub_articles_7", "kpihub_articles_8",
];

// content/{key} баримтын JSON-ыг уншина (нийтэд нээлттэй контент).
// Олдохгүй/эвдэрсэн бол null буцаана.
async function getContent(key) {
  const r = await fetch(docUrl(key));
  if (!r.ok) return null;
  const d = await r.json();
  const f = d && d.fields;
  if (f && typeof (f.json || {}).stringValue === "string") {
    try { return JSON.parse(f.json.stringValue); } catch (e) { return null; }
  }
  return null;
}

// Warm instance доторх богино кэш — Firestore-ыг дэмий давтан асуухгүй.
let cache = { at: 0, list: null };
const TTL = 60 * 1000;

async function getArticles() {
  if (cache.list && Date.now() - cache.at < TTL) return cache.list;
  // Хэсгүүдийг зэрэг уншина — байхгүй хэсэг null буцаана (алдаа биш).
  const parts = await Promise.all(
    ART_SHARD_KEYS.map(function (k) { return getContent(k).catch(function () { return null; }); })
  );
  let list = [];
  parts.forEach(function (p) { if (Array.isArray(p)) list = list.concat(p); });
  cache = { at: Date.now(), list: list };
  return list;
}

function findArticle(list, id) {
  if (!Array.isArray(list) || !id) return null;
  return list.find(function (a) { return a && String(a.id) === String(id); }) || null;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// req.url-аас query утга (Vercel-ийн req.query-д найдалгүй, найдвартай)
function queryParam(req, name) {
  try {
    return new URL(req.url, "http://x").searchParams.get(name) || "";
  } catch (e) {
    return "";
  }
}

function baseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "kpiconsulting.mn";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return proto + "://" + host;
}

// Бүтээгдэхүүн бүрийн хэрэгслүүд хадгалагдах түлхүүр (index/admin-тай ижил)
const TEMPLATE_PRODUCT_KEYS = {
  blueprints: "kpihub_templates",
  diagnostics: "kpihub_templates_diagnostics",
  guided: "kpihub_templates_guided",
  benchmarking: "kpihub_templates_benchmarking",
  workshops: "kpihub_templates_workshops",
  advisory: "kpihub_templates_advisory",
};

// Бүтээгдэхүүний төлбөрийн дүнг СЕРВЕР дээр тооцно — клиентээс ирсэн дүнд
// найдвал хэн ч дурын үнээр төлж чадна. Худалдан авах боломжгүй эсвэл
// үнэ тодорхойгүй бол null.
async function productAmount(key) {
  if (!key || !TEMPLATE_PRODUCT_KEYS[key]) return null;
  const products = await getContent("kpihub_products");
  const p = products && products[key];
  if (!p) return null;
  const buy = p.buy || {};
  if (!buy.enabled) return null;
  if (buy.mode === "parts") {
    const phases = await getContent(TEMPLATE_PRODUCT_KEYS[key]);
    if (!Array.isArray(phases)) return null;
    let sum = 0;
    phases.forEach(function (ph) {
      ((ph && ph.tools) || []).forEach(function (t) {
        sum += Number((t && t.price) || 0) || 0;
      });
    });
    return sum > 0 ? Math.round(sum) : null;
  }
  const amt = Number(buy.amount) || 0;
  return amt > 0 ? Math.round(amt) : null;
}

// POST биеийг уншина (Vercel заримдаа аль хэдийн задалсан байдаг)
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return await new Promise(function (resolve) {
    let raw = "";
    req.on("data", function (c) { raw += c; if (raw.length > 1e5) raw = raw.slice(0, 1e5); });
    req.on("end", function () {
      try { resolve(JSON.parse(raw || "{}")); } catch (e) { resolve({}); }
    });
    req.on("error", function () { resolve({}); });
  });
}

module.exports = {
  getArticles, findArticle, esc, queryParam, baseUrl,
  getContent, productAmount, readJsonBody, TEMPLATE_PRODUCT_KEYS,
};
