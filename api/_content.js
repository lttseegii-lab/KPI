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
const DOC_URL =
  "https://firestore.googleapis.com/v1/projects/" +
  PROJECT +
  "/databases/(default)/documents/content/kpihub_articles?key=" +
  API_KEY;

// Warm instance доторх богино кэш — Firestore-ыг дэмий давтан асуухгүй.
let cache = { at: 0, list: null };
const TTL = 60 * 1000;

async function getArticles() {
  if (cache.list && Date.now() - cache.at < TTL) return cache.list;
  const r = await fetch(DOC_URL);
  if (!r.ok) throw new Error("firestore " + r.status);
  const d = await r.json();
  let list = [];
  const f = d && d.fields;
  if (f && f.json && typeof f.json.stringValue === "string") {
    try { list = JSON.parse(f.json.stringValue); } catch (e) { list = []; }
  }
  if (!Array.isArray(list)) list = [];
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

module.exports = { getArticles, findArticle, esc, queryParam, baseUrl };
