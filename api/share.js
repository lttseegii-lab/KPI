/* Нийтлэлийн хуваалцах хуудас — crawler-т OG таг, хүнд SPA руу шилжүүлэлт.
   -------------------------------------------------------------------------
   Facebook/LinkedIn crawler нь JS ажиллуулдаггүй, #article-<id> hash-ийг үл
   хардаг тул нийтлэл бүрт зориулж энэ жинхэнэ хаяг (/a/<id> → /api/share?a=<id>)
   нь нийтлэлийн гарчиг, тайлбар, ЗУРАГ бүхий OG таг буцаана. Жинхэнэ хэрэглэгч
   ороход шууд SPA дээрх нийтлэл рүү (/#article-<id>) шилжинэ. */
"use strict";

const { getArticles, findArticle, esc, queryParam, baseUrl } = require("./_content.js");

const SITE_TITLE = "KPI consulting — KPI хэмжилт, удирдлагын шийдлүүд";
const SITE_DESC =
  "Байгууллагынхаа гүйцэтгэлийг зөв хэмжиж, ухаалаг удирд. KPI хэмжилт, удирдлагын аргачлал, гарын авлага, темплэйт болон зөвлөх үйлчилгээ.";

module.exports = async (req, res) => {
  const base = baseUrl(req);
  const id = queryParam(req, "a");
  let a = null;
  try { if (id) a = findArticle(await getArticles(), id); } catch (e) { a = null; }

  const title = a ? a.title + " — KPI consulting" : SITE_TITLE;
  const desc = a ? (a.excerpt || SITE_DESC) : SITE_DESC;
  const image = a
    ? base + "/api/og-image?a=" + encodeURIComponent(id)
    : base + "/og-cover.png";
  const canon = a ? base + "/a/" + encodeURIComponent(id) : base + "/";
  const dest = a ? "/#article-" + encodeURIComponent(id) : "/";

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.end(
    '<!doctype html><html lang="mn"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + esc(title) + "</title>" +
    '<meta name="description" content="' + esc(desc) + '">' +
    '<link rel="canonical" href="' + esc(canon) + '">' +
    '<meta property="og:type" content="article">' +
    '<meta property="og:site_name" content="KPI consulting">' +
    '<meta property="og:locale" content="mn_MN">' +
    '<meta property="og:url" content="' + esc(canon) + '">' +
    '<meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="' + esc(desc) + '">' +
    '<meta property="og:image" content="' + esc(image) + '">' +
    '<meta property="og:image:alt" content="' + esc(a ? a.title : "KPI consulting") + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + esc(title) + '">' +
    '<meta name="twitter:description" content="' + esc(desc) + '">' +
    '<meta name="twitter:image" content="' + esc(image) + '">' +
    '<meta http-equiv="refresh" content="0; url=' + esc(dest) + '">' +
    "<script>location.replace(" + JSON.stringify(dest) + ");</script>" +
    '</head><body style="font-family:system-ui,-apple-system,sans-serif;background:#0a1150;color:#fff;padding:48px;text-align:center">' +
    "Нээж байна… " +
    '<a href="' + esc(dest) + '" style="color:#7cc7ff;font-weight:600">KPI consulting нээх</a>' +
    "</body></html>"
  );
};
