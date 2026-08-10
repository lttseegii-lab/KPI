/* QPay-ийн callback — төлбөр төлөгдмөгц QPay энэ хаягийг дууддаг.
   Эрх олголт нь клиентийн polling -> /api/qpay/status (payment/check-ээр
   баталгаажсан) замаар явагддаг тул энд зөвхөн хүлээн авснаа зөвшөөрнө.
   QPay амжилтгүй хариултад callback-аа давтан илгээдэг тул үргэлж 200. */
"use strict";

module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("SUCCESS");
};
