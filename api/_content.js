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
  const host = req.headers["x-forwarded-host"] || req.headers.host || "www.kpiconsulting.mn";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return proto + "://" + host;
}

// ---------------------------------------------------------------------------
// Нийтлэлийн биеийг сервер талд HTML болгон гаргах (crawler-т индекслэгдэх)
// ---------------------------------------------------------------------------
// index.html дахь renderBody/inlineSafe/safeUrl-ийн порт. Node-д DOM байхгүй
// тул inline форматыг (тод, налуу, доогуур, br, холбоос) allowlist regex-ээр
// ариутгана — админы WYSIWYG-ээс ирсэн хязгаарлагдсан HTML-ийг аюулгүй болгоно.

// HTML entity-г задлана. Клиент inlineSafe нь innerHTML-ээр текстийг задалж,
// дараа нь дахин escape хийдэг тул хадгалагдсан &quot; зэрэг entity зөв
// харагддаг. Node-д DOM байхгүй тул адил үр дүнд хүрэхийн тулд эхлээд задална.
function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&#(\d+);/g, function (m, n) { try { return String.fromCodePoint(Number(n)); } catch (e) { return m; } })
    .replace(/&#x([0-9a-f]+);/gi, function (m, n) { try { return String.fromCodePoint(parseInt(n, 16)); } catch (e) { return m; } })
    .replace(/&amp;/g, "&");
}

// href/src-д зөвхөн аюулгүй схем зөвшөөрнө — javascript: зэргийг таслана
function safeUrl(u) {
  const v = String(u == null ? "" : u).trim();
  return /^(https?:|data:image\/|mailto:|tel:|#|\/)/i.test(v) ? esc(v) : "";
}

// Зөвхөн b/i/u/br/a таг үлдээж, бусдыг текст болгож ариутгана.
function inlineSafe(s) {
  s = String(s == null ? "" : s);
  let out = "";
  let last = 0;
  const anchorStack = [];
  const re = /<\/?(?:b|strong|i|em|u|br|a)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(s))) {
    out += esc(decodeEntities(s.slice(last, m.index))); // тагийн өмнөх текстийг задалж, escape
    const tag = m[0];
    const lower = tag.toLowerCase();
    if (/^<br/.test(lower)) {
      out += "<br>";
    } else if (/^<(b|strong)\b/.test(lower)) {
      out += "<b>";
    } else if (/^<\/(b|strong)>/.test(lower)) {
      out += "</b>";
    } else if (/^<(i|em)\b/.test(lower)) {
      out += "<i>";
    } else if (/^<\/(i|em)>/.test(lower)) {
      out += "</i>";
    } else if (/^<u\b/.test(lower)) {
      out += "<u>";
    } else if (/^<\/u>/.test(lower)) {
      out += "</u>";
    } else if (/^<a\b/.test(lower)) {
      const hrefMatch = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      const href = hrefMatch ? decodeEntities((hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || "")).trim() : "";
      const safe = /^(https?:\/\/|mailto:)/i.test(href);
      if (safe) {
        out += '<a href="' + esc(href) + '" target="_blank" rel="noopener">';
        anchorStack.push(true);
      } else {
        anchorStack.push(false); // тагийг орхиж, дотоод текстийг л үлдээнэ
      }
    } else if (/^<\/a>/.test(lower)) {
      const wasSafe = anchorStack.pop();
      if (wasSafe) out += "</a>";
    }
    last = re.lastIndex;
  }
  out += esc(decodeEntities(s.slice(last)));
  return out;
}

// Блокуудыг (index.html-ийн бүтэцтэй ижил) HTML болгоно
function renderBody(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.map(function (b) {
    if (!Array.isArray(b)) return "";
    if (b[0] === "p") return "<p>" + inlineSafe(b[1]) + "</p>";
    if (b[0] === "h3") return "<h3>" + inlineSafe(b[1]) + "</h3>";
    if (b[0] === "blockquote") return "<blockquote>" + inlineSafe(b[1]) + "</blockquote>";
    if (b[0] === "ul") {
      const items = Array.isArray(b[1]) ? b[1] : [];
      return "<ul>" + items.map(function (li) { return "<li>" + inlineSafe(li) + "</li>"; }).join("") + "</ul>";
    }
    if (b[0] === "img") {
      const src = safeUrl(b[1]);
      if (!src) return "";
      const cap = esc(b[2] || "");
      return '<figure><img src="' + src + '" alt="' + cap + '" loading="lazy">'
        + (cap ? "<figcaption>" + cap + "</figcaption>" : "") + "</figure>";
    }
    return "";
  }).join("");
}

// Блокуудаас энгийн текст — meta description-д (excerpt байхгүй үед)
function bodyText(blocks) {
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  blocks.forEach(function (b) {
    if (!Array.isArray(b)) return;
    if (b[0] === "p" || b[0] === "h3" || b[0] === "blockquote") parts.push(String(b[1] || ""));
    else if (b[0] === "ul" && Array.isArray(b[1])) parts.push(b[1].join(". "));
  });
  return decodeEntities(parts.join(" ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// Нийтлэлийн id-аас нийтлэсэн огноог гаргах. id нь ихэвчлэн ms timestamp
// агуулдаг (ж: "x1786091739127"). Олдохгүй бол null (seed a1..a6).
function articleTimestamp(id) {
  const m = /(\d{13})/.exec(String(id || ""));
  if (!m) return null;
  const n = Number(m[1]);
  // 2001..2100 орчмын бодит хугацаа мөн эсэхийг шалгана
  if (n < 1e12 || n > 4102444800000) return null;
  return n;
}
function articleISODate(id) {
  const t = articleTimestamp(id);
  return t ? new Date(t).toISOString() : null;
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
  safeUrl, inlineSafe, renderBody, bodyText, articleTimestamp, articleISODate,
};
