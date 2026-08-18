/* Темплэйт багцын төлбөрийн нэхэмжлэл үүсгэнэ — QR болон холбоосыг буцаана.

   Сайт дээр ШУУД төлбөр авдаг цорын ганц зүйл нь темплэйт багц. Бусад
   бүтээгдэхүүн (аудит, зөвлөгөө, сургалт, бенчмарк) нь үнийн саналын
   хүсэлтээр явж, и-мэйлээр үнэ хүргэдэг тул энд орохгүй. */
"use strict";

const { qpayFetch, sendJson, sendError, guard } = require("./_lib.js");
const { productAmount, readJsonBody } = require("../_content.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST хүсэлт илгээнэ үү" });
  }
  // Нэхэмжлэл үүсгэх нь QPay дээр бодит бичлэг үлдээдэг тул чанга хязгаар
  if (guard(req, res, 10, 60 * 1000)) return;
  try {
    // Бүтээгдэхүүн заасан бол түүний үнийг ФАЙРСТОРООС уншиж тооцно. Клиентээс
    // ирсэн дүнг хэзээ ч хүлээж авахгүй — эс бөгөөс дурын үнээр төлж болно.
    const body = await readJsonBody(req);
    const key = String((body && body.product) || "").slice(0, 40);
    let amount = null;
    let label = "темплэйт багц";
    if (key) {
      amount = await productAmount(key);
      if (!amount) {
        return sendJson(res, 400, { error: "Энэ бүтээгдэхүүнийг шууд худалдан авах боломжгүй байна." });
      }
      label = key;
    } else {
      amount = Math.max(1, Number(process.env.QPAY_AMOUNT || 99000));
    }
    const senderInvoiceNo =
      "KPI-T-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const callbackUrl =
      "https://" + host + "/api/qpay/callback?sender_invoice_no=" + senderInvoiceNo;

    const r = await qpayFetch("/invoice", {
      method: "POST",
      body: {
        invoice_code: process.env.QPAY_INVOICE_CODE,
        sender_invoice_no: senderInvoiceNo,
        invoice_receiver_code: "terminal",
        invoice_description:
          "KPI consulting — " + label + " " + senderInvoiceNo,
        amount: amount,
        callback_url: callbackUrl,
      },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.invoice_id) {
      const err = new Error(
        "Нэхэмжлэл үүсгэж чадсангүй" + (d && d.message ? ": " + d.message : "")
      );
      err.statusCode = 502;
      throw err;
    }
    sendJson(res, 200, {
      invoice_id: d.invoice_id,
      amount: amount,
      qr_text: d.qr_text || "",
      qr_image: d.qr_image || "",
      short_url: d.qPay_shortUrl || "",
      urls: Array.isArray(d.urls) ? d.urls : [],
    });
  } catch (err) {
    sendError(res, err);
  }
};
