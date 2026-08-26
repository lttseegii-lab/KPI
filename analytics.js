/* =========================================================================
   KPI consulting — хуудас үзэлтийн энгийн хэмжилт
   =========================================================================
   Firestore-ийн REST API руу шууд бичдэг тул Firebase SDK шаардахгүй
   (kpi360.html шиг зөвхөн landing page байхад SDK татах нь илүүц хүнд).

   Өдөр тутмын нэг баримт: analytics/YYYY-MM-DD. Талбар бүрийг
   increment-ээр өсгөнө — тусдаа мөр бичихгүй тул уншилтын өртөг тогтмол.

     { day, views, visitors,
       pages:{...}, articles:{...}, refs:{...}, devices:{...}, browsers:{...} }

   • views     — хуудас үзэлт бүр
   • visitors  — тухайн өдөр анх орсон хөтөч тус бүр нэг удаа
   • refs / devices / browsers — сесс тус бүр нэг удаа (үзэлт бүрд биш)

   Огноог Монголын цагаар (UTC+8) тоолно — админы тайлан орон нутгийн
   өдрөөр таарч байхын тулд. Зочин ямар ч цагийн бүсээс орсон нэг ижил.
   ========================================================================= */
(function () {
  "use strict";

  var PROJECT = "kpiconsulting";
  var API_KEY = "AIzaSyBvjR_5pAAksA4UcQeRyzt6bEL1yk717Pw";
  var DOC_BASE = "projects/" + PROJECT + "/databases/(default)/documents/analytics/";
  var COMMIT_URL = "https://firestore.googleapis.com/v1/projects/" + PROJECT
    + "/databases/(default)/documents:commit?key=" + API_KEY;

  var TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Улаанбаатар, UTC+8 (зуны цаг байхгүй)

  // ---- Хэмжих эсэхийг шийдэх ------------------------------------------------
  // Бот, дев орчин, автоматжуулсан хөтчийг тоохгүй — тайланг бохирдуулна.
  function shouldTrack() {
    try {
      if (location.protocol === "file:") return false;
      var h = location.hostname;
      if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "") return false;
      if (navigator.webdriver) return false;
      if (/bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegrambot/i
          .test(navigator.userAgent)) return false;
      return true;
    } catch (e) { return false; }
  }

  // ---- Туслахууд ------------------------------------------------------------
  function mnDay(ts) {
    return new Date((ts == null ? Date.now() : ts) + TZ_OFFSET_MS).toISOString().slice(0, 10);
  }
  // Firestore-ийн талбарын нэрэнд ашиглахад аюулгүй болгоно
  function key(s, max) {
    s = String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9_-]+/g, "-")
         .replace(/^-+|-+$/g, "");
    if (!s) s = "other";
    return s.slice(0, max || 48);
  }
  function store(kind) {
    try { return kind === "s" ? window.sessionStorage : window.localStorage; }
    catch (e) { return null; } // приват горим / хориглосон
  }
  function once(kind, name) {
    var st = store(kind);
    if (!st) return true;            // хадгалж чадахгүй бол дор хаяж нэг удаа бүртгэнэ
    try {
      if (st.getItem(name)) return false;
      st.setItem(name, "1");
      return true;
    } catch (e) { return true; }
  }

  // ---- Ангилагчид -----------------------------------------------------------
  function device() {
    var ua = navigator.userAgent;
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
    if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return "mobile";
    return "desktop";
  }
  function browser() {
    var ua = navigator.userAgent;
    if (/SamsungBrowser/i.test(ua)) return "samsung";
    if (/Edg\//i.test(ua)) return "edge";
    if (/OPR\/|Opera/i.test(ua)) return "opera";
    if (/Firefox\/|FxiOS/i.test(ua)) return "firefox";
    if (/Chrome\/|CriOS/i.test(ua)) return "chrome";
    if (/Safari\//i.test(ua)) return "safari";
    return "other";
  }
  // Хаанаас орж ирсэн — utm_source байвал түүнийг эрхэмлэнэ (кампанит ажлын холбоос)
  function source() {
    try {
      var utm = new URLSearchParams(location.search).get("utm_source");
      if (utm) return key(utm, 32);
    } catch (e) {}

    var ref = document.referrer || "";
    if (!ref) return "direct";
    var host;
    try { host = new URL(ref).hostname.toLowerCase().replace(/^www\./, ""); }
    catch (e) { return "other"; }
    if (!host || host === location.hostname.replace(/^www\./, "")) return "direct";

    if (/(^|\.)facebook\.com$|^fb\.(com|me)$/.test(host)) return "facebook";
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    if (/(^|\.)google\./.test(host)) return "google";
    if (/(^|\.)linkedin\.com$|^lnkd\.in$/.test(host)) return "linkedin";
    if (/(^|\.)(twitter\.com|x\.com)$|^t\.co$/.test(host)) return "twitter";
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "youtube";
    if (/(^|\.)bing\.com$/.test(host)) return "bing";
    if (/(^|\.)(yahoo|duckduckgo|yandex)\./.test(host)) return "search-other";
    if (/messenger\.com$|^l\.facebook\.com$/.test(host)) return "facebook";
    return key(host, 40);
  }
  // Замаас хуудасны түлхүүр — «/» нүүр, «/kpi360» сургалт, бусад нь замаараа
  function pageKey() {
    var p = location.pathname.replace(/\.html$/, "").replace(/\/+$/, "");
    if (!p || p === "/index") return "home";
    return key(p.replace(/^\//, ""), 48);
  }

  // ---- Firestore руу бичих --------------------------------------------------
  // update + updateTransforms: баримт байхгүй бол шинээр үүсгэж, байвал нэмнэ.
  function commit(transforms) {
    if (!transforms.length) return;
    var day = mnDay();
    var body = {
      writes: [{
        update: { name: DOC_BASE + day, fields: { day: { stringValue: day } } },
        updateMask: { fieldPaths: ["day"] },
        updateTransforms: transforms
      }]
    };
    try {
      fetch(COMMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,        // хуудас хаагдаж байхад ч илгээгдэнэ
        credentials: "omit"
      }).catch(function () {});  // хэмжилт бүтэлгүйтсэн нь хэрэглэгчид хамаагүй
    } catch (e) {}
  }
  function inc(path, by) {
    return { fieldPath: path, increment: { integerValue: String(by || 1) } };
  }
  // Map доторх түлхүүрийг ` `-ээр хашина — тоогоор эхэлсэн/зураастай ч ажиллана
  function mapPath(field, k) { return field + ".`" + k + "`"; }

  // ---- Нийтийн API ----------------------------------------------------------
  // KPITrack.view()                 — одоогийн хуудсыг бүртгэнэ
  // KPITrack.view("article", "<id>")— нийтлэл нээгдсэнийг бүртгэнэ
  function view(kind, label) {
    if (!shouldTrack()) return;

    var page = kind === "article" ? "article" : (kind ? key(kind, 48) : pageKey());
    var t = [inc("views"), inc(mapPath("pages", page))];

    if (kind === "article" && label) t.push(inc(mapPath("articles", key(label, 60))));

    var day = mnDay();
    if (once("l", "kpi_seen_" + day)) t.push(inc("visitors"));
    // Эх сурвалж, төхөөрөмжийг сесс тус бүрд нэг л удаа — үзэлт бүрд давхарлахгүй
    if (once("s", "kpi_sess")) {
      t.push(inc(mapPath("refs", source())));
      t.push(inc(mapPath("devices", device())));
      t.push(inc(mapPath("browsers", browser())));
    }
    commit(t);
  }

  window.KPITrack = { view: view, day: mnDay };

  // Хуудас ачаалагдмагц автоматаар нэг үзэлт бүртгэнэ
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { view(); });
  } else {
    view();
  }
})();
