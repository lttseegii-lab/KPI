/* Нийтлэлийн зургийг og:image болгон гаргана.
   -------------------------------------------------------------------------
   Нийтлэлийн зураг Firestore-д data:URI (base64) хэлбэрээр хадгалагддаг тул
   Facebook/LinkedIn шууд ашиглаж чадахгүй. Энэ функц түүнийг задалж жинхэнэ
   зураг болгон буцаана. FB/LinkedIn найдвартай дэмждэг төрлүүд (jpeg, png,
   gif, webp) л шууд гарна; бусад (жишээ нь avif) эсвэл зураггүй бол брэндийн
   /og-cover.png руу шилжүүлнэ. */
"use strict";

const { getArticles, findArticle, queryParam } = require("./_content.js");

const OK_TYPES = {
  "image/jpeg": true,
  "image/png": true,
  "image/gif": true,
  "image/webp": true,
};

function fallback(res) {
  res.statusCode = 302;
  res.setHeader("Location", "/og-cover.png");
  res.setHeader("Cache-Control", "public, max-age=600");
  res.end();
}

module.exports = async (req, res) => {
  try {
    const id = queryParam(req, "a");
    let dataUri = "";
    if (id) {
      const a = findArticle(await getArticles(), id);
      if (a && typeof a.image === "string") dataUri = a.image;
    }
    const m = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(dataUri);
    if (!m) return fallback(res);
    const mime = m[1].toLowerCase();
    if (!OK_TYPES[mime]) return fallback(res);
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length) return fallback(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.end(buf);
  } catch (e) {
    fallback(res);
  }
};
