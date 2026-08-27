/* Нийтлэлийн бие даасан хуудас — /a/<id> (vercel.json rewrite → /api/share?a=<id>)
   -------------------------------------------------------------------------
   Урьд нь энэ хуудас crawler-т зөвхөн OG таг өгөөд хүнийг SPA hash руу шууд
   шилжүүлдэг байсан тул Google-д индекслэгдэх бодит контентгүй, нийтлэлүүд
   хайлтад гардаггүй байв. Одоо crawler болон хүнд ИЖИЛ бүрэн нийтлэлийг
   (гарчиг, огноо, зураг, бүтэн бие) бодит HTML-ээр өгнө — indexable хуудас.
   OG/Twitter/canonical нь өөрийгөө (/a/<id>) заана; BlogPosting JSON-LD-тэй. */
"use strict";

const {
  getArticles, findArticle, esc, queryParam, baseUrl,
  renderBody, bodyText, articleISODate, imageSize,
} = require("./_content.js");

const SITE = "KPI consulting";
const SITE_TITLE = "KPI consulting — KPI хэмжилт, удирдлагын шийдлүүд";
const SITE_DESC =
  "Байгууллагынхаа гүйцэтгэлийг зөв хэмжиж, ухаалаг удирд. KPI хэмжилт, удирдлагын аргачлал, гарын авлага, темплэйт болон зөвлөх үйлчилгээ.";

// Meta description — excerpt эсвэл биеийн эхнээс ~160 тэмдэгт
function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a1150;--soft:#0f1a6b;--card:#16227e;--line:#2e3ba8;--text:#eef3ff;--muted:#aeb9ea;--accent:#4faeee}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit}
img{display:block;max-width:100%}
.top{border-bottom:1px solid var(--line);background:rgba(10,17,80,.85);backdrop-filter:saturate(140%) blur(8px);position:sticky;top:0;z-index:5}
.top .in{max-width:760px;margin:0 auto;padding:16px 22px;display:flex;align-items:center;justify-content:space-between}
.brand{font-size:18px;font-weight:600;color:var(--muted);text-decoration:none}
.brand b{color:#fff;font-weight:800}
.back{font-size:13.5px;color:var(--muted);text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:8px 14px}
.back:hover{color:#fff;border-color:var(--accent)}
main{max-width:760px;margin:0 auto;padding:34px 22px 64px}
.eyebrow{font-size:12.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--accent)}
h1{font-size:33px;line-height:1.22;margin:14px 0 12px;letter-spacing:-.3px}
.meta{font-size:13px;color:var(--muted);margin-bottom:24px}
.cover{border-radius:16px;overflow:hidden;margin:0 0 28px;border:1px solid var(--line)}
.cover img{width:100%;height:auto}
.hero-ic{aspect-ratio:16/8;display:grid;place-items:center;font-size:76px;background:linear-gradient(160deg,#16227e,#0f1a6b)}
article p{margin:0 0 18px;font-size:16.5px;color:#e6ecff}
article h3{font-size:20px;margin:30px 0 12px;color:#fff}
article ul{margin:0 0 18px;padding-left:22px}
article li{margin:0 0 9px;font-size:16px;color:#e6ecff}
article blockquote{margin:22px 0;padding:14px 20px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 10px 10px 0;color:#dfe7ff;font-style:italic}
article figure{margin:22px 0}
article figure img{width:100%;border-radius:12px;border:1px solid var(--line)}
article figcaption{font-size:12.5px;color:var(--muted);margin-top:8px;text-align:center}
article a{color:var(--accent);text-decoration:underline}
.cta{margin:40px 0 8px;padding:24px;background:var(--card);border:1px solid var(--line);border-radius:16px;text-align:center}
.cta p{margin:0 0 14px;color:var(--muted);font-size:14.5px}
.btn{display:inline-block;background:var(--accent);color:#00122b;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:11px;font-size:14.5px}
.more{margin-top:44px;border-top:1px solid var(--line);padding-top:26px}
.more h2{font-size:15px;color:var(--muted);font-weight:700;margin-bottom:14px}
.more a{display:block;text-decoration:none;color:var(--text);padding:12px 0;border-bottom:1px solid var(--line);font-size:15.5px}
.more a:last-child{border-bottom:0}
.more a:hover{color:var(--accent)}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;text-align:center;padding:26px 22px}
`;

module.exports = async (req, res) => {
  const base = baseUrl(req);
  const id = queryParam(req, "a");

  let list = [];
  try { list = await getArticles(); } catch (e) { list = []; }
  const a = id ? findArticle(list, id) : null;

  // Нийтлэл олдохгүй бол сайтын үндсэн OG-тэй, нүүр рүү шилжүүлэх stub
  if (!a) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.end(
      '<!doctype html><html lang="mn"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" + esc(SITE_TITLE) + "</title>" +
      '<meta name="description" content="' + esc(SITE_DESC) + '">' +
      '<link rel="canonical" href="' + esc(base + "/") + '">' +
      '<meta name="robots" content="noindex, follow">' +
      '<meta http-equiv="refresh" content="0; url=/">' +
      '<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a1150;color:#fff;padding:48px;text-align:center}a{color:#7cc7ff;font-weight:600}</style>' +
      '</head><body>Нийтлэл олдсонгүй. <a href="/">Нүүр хуудас руу очих</a></body></html>'
    );
    return;
  }

  const canon = base + "/a/" + encodeURIComponent(id);
  const title = a.title + " — " + SITE;
  const desc = clip(a.excerpt || bodyText(a.body) || SITE_DESC, 160);
  // og:image-ийг /api/-ийн доор биш, цэвэр /og/<id> замаар өгнө. robots.txt нь
  // /api/-г Disallow хийдэг тул Facebook /api/og-image-ийг татаж чаддаггүй
  // ("Corrupted Image") байв. /og/<id> нь зөвшөөрөгдсөн — vercel.json дотор
  // /api/og-image рүү rewrite хийгддэг.
  const ogImage = base + "/og/" + encodeURIComponent(id);
  const iso = articleISODate(id);
  const author = a.author || SITE;

  // Cover ба og:image-ийн хэмжээ/төрөл. Растер зурагтай бол og-image түүнийг
  // шууд өгнө (хэмжээ = imageSize); эс бол og-cover.png (1200×630). Facebook
  // эхний scrape-д зургийг шууд гаргахын тулд og:image:width/height зарлана.
  const photoMime = ((typeof a.image === "string"
    && /^data:(image\/(?:jpeg|jpg|png|gif|webp))/i.exec(a.image)) || [])[1];
  const hasPhoto = !!photoMime;
  let ogW = 1200, ogH = 630, ogType = "image/png";
  if (hasPhoto) {
    ogType = photoMime.toLowerCase() === "image/jpg" ? "image/jpeg" : photoMime.toLowerCase();
    const dim = imageSize(a.image);
    if (dim) { ogW = dim.w; ogH = dim.h; } else { ogW = 0; ogH = 0; } // тодорхойгүй бол зарлахгүй
  }
  const coverDims = (ogW && ogH) ? ' width="' + ogW + '" height="' + ogH + '"' : "";
  const coverHtml = hasPhoto
    ? '<div class="cover"><img src="' + esc(ogImage) + '" alt="' + esc(a.title) + '"' + coverDims + '></div>'
    : '<div class="cover"><div class="hero-ic">' + esc(a.icon || "📊") + "</div></div>";

  // Метадата мөр (ангилал | огноо · унших)
  const metaBits = [a.date, a.read].filter(Boolean).join(" · ");

  // Бусад нийтлэл — crawl-discovery ба дотоод холбоос
  const others = list.filter(x => x && x.id !== id).slice(0, 5);
  const moreHtml = others.length
    ? '<nav class="more"><h2>Бусад нийтлэл</h2>' +
      others.map(x =>
        '<a href="/a/' + esc(encodeURIComponent(x.id)) + '">' + esc(x.title) + "</a>"
      ).join("") + "</nav>"
    : "";

  // BlogPosting JSON-LD. Publisher-ийг бүрэн Organization (нэр + logo)-оор
  // шигтгэнэ — зөвхөн @id reference өгвөл энэ хуудсанд Organization node
  // байхгүй тул Google "Thing" гэж үзэж, publisher.logo дутуу болно.
  const org = {
    "@type": "Organization",
    "@id": base + "/#organization",
    "name": SITE,
    "url": base + "/",
    "logo": { "@type": "ImageObject", "url": base + "/apple-touch-icon.png" },
  };
  const ld = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": canon + "#article",
    "mainEntityOfPage": { "@type": "WebPage", "@id": canon },
    "headline": a.title,
    "description": desc,
    "image": ogImage,
    "inLanguage": "mn-MN",
    "articleSection": a.cat || undefined,
    "author": { "@type": "Organization", "name": author, "url": base + "/" },
    "publisher": org,
  };
  if (iso) { ld.datePublished = iso; ld.dateModified = iso; }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.end(
    '<!doctype html><html lang="mn"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + esc(title) + "</title>" +
    '<meta name="description" content="' + esc(desc) + '">' +
    '<link rel="canonical" href="' + esc(canon) + '">' +
    '<meta name="robots" content="index, follow, max-image-preview:large">' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<link rel="icon" href="/favicon.ico" sizes="32x32">' +
    '<meta name="theme-color" content="#0a1150">' +
    '<meta property="og:type" content="article">' +
    '<meta property="og:site_name" content="' + esc(SITE) + '">' +
    '<meta property="og:locale" content="mn_MN">' +
    '<meta property="og:url" content="' + esc(canon) + '">' +
    '<meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="' + esc(desc) + '">' +
    '<meta property="og:image" content="' + esc(ogImage) + '">' +
    '<meta property="og:image:alt" content="' + esc(a.title) + '">' +
    (ogW && ogH ? '<meta property="og:image:width" content="' + ogW + '">' : "") +
    (ogW && ogH ? '<meta property="og:image:height" content="' + ogH + '">' : "") +
    '<meta property="og:image:type" content="' + esc(ogType) + '">' +
    (iso ? '<meta property="article:published_time" content="' + esc(iso) + '">' : "") +
    (a.cat ? '<meta property="article:section" content="' + esc(a.cat) + '">' : "") +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + esc(title) + '">' +
    '<meta name="twitter:description" content="' + esc(desc) + '">' +
    '<meta name="twitter:image" content="' + esc(ogImage) + '">' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + "</script>" +
    "<style>" + CSS + "</style></head><body>" +
    '<header class="top"><div class="in">' +
    '<a class="brand" href="/"><b>KPI</b>&nbsp;consulting</a>' +
    '<a class="back" href="/">← Бүх нийтлэл</a>' +
    "</div></header>" +
    "<main><article>" +
    '<div class="eyebrow">' + esc(a.cat || SITE) + "</div>" +
    "<h1>" + esc(a.title) + "</h1>" +
    (metaBits ? '<div class="meta">' + esc(metaBits) + "</div>" : "") +
    coverHtml +
    renderBody(a.body) +
    "</article>" +
    '<div class="cta"><p>Байгууллагынхаа гүйцэтгэлийг зөв хэмжиж, ухаалаг удирдъя.</p>' +
    '<a class="btn" href="/">KPI consulting-тэй танилцах</a></div>' +
    moreHtml +
    "</main>" +
    '<footer>© 2026 ' + esc(SITE) + ". KPI хэмжилт, гүйцэтгэлийн үнэлгээ, зөвлөх үйлчилгээ.</footer>" +
    "</body></html>"
  );
};
