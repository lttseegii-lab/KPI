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

/* Сайтын дотоод уншигчтай (index.html-ийн .reader-*) ижил ЦАЙВАР загвар.
   Гүн хөх дэвсгэр дээр урт нийтлэл унших нь ядаргаатай байсан тул энд ч
   #f2f3f7 дэвсгэр, хар бичвэр, төвлөрсөн serif гарчиг — өөрөөр хэлбэл
   хэрэглэгч сайт дотор нээсэн ч, сошиалын холбоосоор орж ирсэн ч ялгаагүй
   нэг л хуудас харна. Өнгө, хэмжээсүүд index.html:432-560-аас хуулбарлав. */
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--page:#f2f3f7;--ink:#1a1a1a;--line:#e3e5ec;--muted:#6b7280;--accent:#45a8f0;--link:#15529c;--brand:#0a1150}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;background:var(--page);color:var(--ink);line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit}
img{display:block;max-width:100%}
.top{border-bottom:1px solid var(--line);background:rgba(242,243,247,.9);backdrop-filter:saturate(140%) blur(8px);position:sticky;top:0;z-index:5}
.top .in{max-width:1040px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.brand{font-size:18px;font-weight:600;color:#5b6270;text-decoration:none}
.brand b{color:#14161c;font-weight:800}
.back{font-size:14px;color:#444;text-decoration:none;border:1px solid #cfd2da;border-radius:999px;padding:8px 18px;background:#fff;font-weight:500}
.back:hover{color:var(--link);border-color:var(--link)}
main{max-width:1040px;margin:0 auto;padding:26px 24px 90px}
.eyebrow{text-align:center;color:#6b6b6b;font-size:15px;margin-bottom:18px}
h1{text-align:center;font-family:Georgia,"Times New Roman",serif;font-weight:700;font-size:clamp(26px,4vw,40px);line-height:1.18;color:#111;letter-spacing:-.3px;max-width:900px;margin:0 auto 18px}
.byline{text-align:center;font-size:19px;color:#111;margin-bottom:10px}
.byline b{color:var(--link);font-weight:800}
.meta{text-align:center;font-size:15px;color:#444;margin-bottom:34px}
.cover{max-width:1000px;margin:0 auto 34px;border-radius:12px;overflow:hidden;border:1px solid #e2e4ea;background:#eef0f5}
.cover img{width:100%;height:auto}
.hero-ic{aspect-ratio:16/8;display:grid;place-items:center;font-size:90px;background:linear-gradient(160deg,#eef1f7,#e3e7f2)}
article{max-width:720px;margin:0 auto}
article p{margin:0 0 18px;font-size:16.5px;color:#222;line-height:1.75}
article h3{font-size:20px;font-weight:700;color:#111;margin:30px 0 10px}
article ul{margin:0 0 20px 4px;padding:0;display:flex;flex-direction:column;gap:11px;list-style:none}
article li{display:flex;gap:12px;font-size:16.5px;color:#222;line-height:1.65}
article li::before{content:"•";color:var(--accent);font-weight:800}
article blockquote{border-left:4px solid var(--accent);padding:6px 0 6px 22px;margin:24px 0;color:#444;font-style:italic;font-size:17.5px;line-height:1.6}
article figure{margin:30px 0}
article figure img{width:100%;max-height:520px;object-fit:cover;border-radius:12px;border:1px solid #e2e4ea;background:#eef0f5}
article figcaption{margin-top:8px;font-size:13px;color:#666;text-align:center}
article a{color:var(--link);text-decoration:underline;text-underline-offset:2px}
article .lg{font-size:1.3em}article .sm{font-size:0.82em}
.cta{max-width:720px;margin:46px auto 0;padding-top:26px;border-top:1px solid #e0e2e9;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.cta p{margin:0;color:#5b6270;font-size:15px;flex:1 1 260px}
.btn{display:inline-block;background:#1f7ae0;color:#fff;font-weight:700;text-decoration:none;padding:11px 24px;border-radius:999px;font-size:15px}
.btn:hover{background:#1663bb}
.more{max-width:1000px;margin:48px auto 0}
.more h2{font-size:12.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:18px}
.more-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.more-card{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;display:flex;flex-direction:column;text-decoration:none;color:inherit;transition:box-shadow .2s,transform .2s,border-color .2s}
.more-card:hover{box-shadow:0 14px 32px rgba(0,0,0,.11);transform:translateY(-3px);border-color:#d4d7e0}
.more-thumb{height:172px;display:grid;place-items:center;font-size:48px;background:#eef1f7}
.more-thumb img{width:100%;height:100%;object-fit:cover}
.more-body{padding:16px 18px 20px}
.more-meta{display:flex;align-items:center;gap:10px;font-size:12.5px;margin-bottom:10px}
.more-cat{font-weight:700;color:#14161c}
.more-date{color:var(--muted)}
.more-title{font-size:17px;font-weight:800;line-height:1.32;color:#14161c}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;text-align:center;padding:26px 22px}
@media (max-width:860px){.more-grid{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.more-grid{grid-template-columns:1fr}}
`;

module.exports = async (req, res) => {
  const base = baseUrl(req);
  const id = queryParam(req, "a");

  let list = [];
  try { list = await getArticles(); } catch (e) { list = []; }
  const a = id ? findArticle(list, id) : null;

  // Нийтлэл олдохгүй бол сайтын үндсэн OG-тэй, нүүр рүү шилжүүлэх stub.
  //
  // OG тагуудыг ЗААВАЛ гаргана: Firestore-ийн уншилт түр саатсан, эсвэл хэн
  // нэгэн хуучин/буруу хаяг хуваалцсан тохиолдолд ч Facebook, LinkedIn зэрэг
  // scraper хоосон хариу авах ёсгүй. OG таггүй хуудсыг олж авбал тэдгээр нь
  // гарчгийн оронд нүцгэн хаягийг ("www.kpiconsulting.mn") харуулдаг бөгөөд
  // тэр буруу preview-г 30 хоног кэшлэдэг.
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
      '<meta property="og:type" content="website">' +
      '<meta property="og:site_name" content="' + esc(SITE) + '">' +
      '<meta property="og:locale" content="mn_MN">' +
      '<meta property="og:url" content="' + esc(base + "/") + '">' +
      '<meta property="og:title" content="' + esc(SITE_TITLE) + '">' +
      '<meta property="og:description" content="' + esc(SITE_DESC) + '">' +
      '<meta property="og:image" content="' + esc(base + "/og-cover.png") + '">' +
      '<meta property="og:image:type" content="image/png">' +
      '<meta property="og:image:width" content="1200">' +
      '<meta property="og:image:height" content="630">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      '<meta name="twitter:title" content="' + esc(SITE_TITLE) + '">' +
      '<meta name="twitter:description" content="' + esc(SITE_DESC) + '">' +
      '<meta name="twitter:image" content="' + esc(base + "/og-cover.png") + '">' +
      '<meta http-equiv="refresh" content="0; url=/">' +
      '<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f2f3f7;color:#1a1a1a;padding:48px;text-align:center}a{color:#15529c;font-weight:600}</style>' +
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
  // Хуудсан доторх <img> нь ХАРЬЦАНГУЙ зам ашиглана (og:image заавал үнэмлэхүй
  // байх ёстой тул тэнд `ogImage` хэвээр). Ингэснээр http/https, apex/www
  // алийг нь ч дагаад ажиллана.
  const coverSrc = "/og/" + encodeURIComponent(id);
  const coverHtml = hasPhoto
    ? '<div class="cover"><img src="' + esc(coverSrc) + '" alt="' + esc(a.title) + '"' + coverDims + '></div>'
    : '<div class="cover"><div class="hero-ic">' + esc(a.icon || "📊") + "</div></div>";

  // Метадата мөр (ангилал | огноо · унших)
  const metaBits = [a.date, a.read].filter(Boolean).join(" · ");

  // Бусад нийтлэл — crawl-discovery ба дотоод холбоос. Сайтын уншигчийн
  // "холбоотой нийтлэл" картуудтай ижил: зураг, ангилал/огноо, гарчиг.
  const others = list.filter(x => x && x.id !== id).slice(0, 3);
  const moreHtml = others.length
    ? '<nav class="more"><h2>Бусад нийтлэл</h2><div class="more-grid">' +
      others.map(x => {
        const thumb = x.image
          ? '<img src="/og/' + esc(encodeURIComponent(x.id)) + '" alt="' + esc(x.title) +
            '" loading="lazy" width="1200" height="630">'
          : "<span>" + esc(x.icon || "📄") + "</span>";
        const bits = (x.cat ? '<span class="more-cat">' + esc(x.cat) + "</span>" : "") +
          (x.date ? '<span class="more-date">' + esc(x.date) + "</span>" : "");
        return '<a class="more-card" href="/a/' + esc(encodeURIComponent(x.id)) + '">' +
          '<div class="more-thumb">' + thumb + "</div>" +
          '<div class="more-body">' +
          (bits ? '<div class="more-meta">' + bits + "</div>" : "") +
          '<div class="more-title">' + esc(x.title) + "</div>" +
          "</div></a>";
      }).join("") + "</div></nav>"
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
    '<meta name="theme-color" content="#f2f3f7">' +
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
    // Гарчиг, зохиогч, cover нь <article>-ээс ГАДНА байна: биеийг 720px-ээр
    // уншихад тохиромжтой нарийхан баганад барьж, гарчиг (900px) болон
    // зургийг (1000px) илүү өргөн байлгахын тулд — сайтын уншигчтай адил.
    "<main>" +
    '<div class="eyebrow">' + esc(a.cat || "Нийтлэл") + " | " + esc(SITE) + "</div>" +
    "<h1>" + esc(a.title) + "</h1>" +
    (a.author ? '<div class="byline">By <b>' + esc(a.author) + "</b></div>" : "") +
    (metaBits ? '<div class="meta">' + esc(metaBits) + "</div>" : "") +
    coverHtml +
    "<article>" + renderBody(a.body) + "</article>" +
    '<div class="cta"><p>Байгууллагынхаа гүйцэтгэлийг зөв хэмжиж, ухаалаг удирдъя.</p>' +
    '<a class="btn" href="/">KPI consulting-тэй танилцах</a></div>' +
    moreHtml +
    "</main>" +
    '<footer>© 2026 ' + esc(SITE) + ". KPI хэмжилт, гүйцэтгэлийн үнэлгээ, зөвлөх үйлчилгээ.</footer>" +
    "</body></html>"
  );
};
