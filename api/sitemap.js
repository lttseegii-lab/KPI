/* Динамик sitemap.xml — /sitemap.xml (vercel.json rewrite → /api/sitemap)
   -------------------------------------------------------------------------
   Статик sitemap нь зөвхөн / ба /kpi360-г жагсаадаг байсан тул нийтлэлүүд
   хайлтын системд ороогүй. Энэ функц Firestore-оос бүх нийтлэлийг уншиж,
   /a/<id> хаяг бүрийг lastmod-той нэмнэ. Хост нь хүсэлтийн (www) домейнийг
   дагана. */
"use strict";

const { getArticles, baseUrl, esc, articleISODate } = require("./_content.js");

function urlTag(loc, lastmod, changefreq, priority) {
  return (
    "  <url>\n" +
    "    <loc>" + esc(loc) + "</loc>\n" +
    (lastmod ? "    <lastmod>" + esc(lastmod) + "</lastmod>\n" : "") +
    (changefreq ? "    <changefreq>" + changefreq + "</changefreq>\n" : "") +
    (priority ? "    <priority>" + priority + "</priority>\n" : "") +
    "  </url>"
  );
}

module.exports = async (req, res) => {
  const base = baseUrl(req);
  const today = "2026-08-27"; // статик хуудсуудын lastmod (deploy бүрд шинэчилж болно)

  let articles = [];
  try { articles = await getArticles(); } catch (e) { articles = []; }

  const urls = [
    urlTag(base + "/", today, "weekly", "1.0"),
    urlTag(base + "/kpi360", "2026-08-26", "weekly", "0.9"),
  ];

  articles.forEach(function (a) {
    if (!a || !a.id) return;
    const iso = articleISODate(a.id);
    const lastmod = iso ? iso.slice(0, 10) : today;
    urls.push(urlTag(base + "/a/" + encodeURIComponent(a.id), lastmod, "monthly", "0.7"));
  });

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join("\n") + "\n" +
    "</urlset>\n";

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
  res.end(xml);
};
