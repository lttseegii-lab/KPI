/* Төлбөрийн нэхэмжлэл үүсгэнэ — QR болон холбоосыг буцаана.
   Хоёр төрөл: membership (гишүүнчлэл) ба booking (зөвлөгөөний цаг). */
"use strict";

const { qpayFetch, sendJson, sendError } = require("./_lib.js");

const PURPOSES = {
  membership: {
    envAmount: "QPAY_AMOUNT",
    fallback: 99000,
    prefix: "KPI-M",
    description: "KPI consulting — гишүүнчлэл (темплэйт татах эрх)",
  },
  booking: {
    envAmount: "QPAY_BOOKING_AMOUNT",
    fallback: 50000,
    prefix: "KPI-B",
    description: "KPI consulting — зөвлөгөөний цаг",
  },
};

function readBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST хүсэлт илгээнэ үү" });
  }
  try {
    const body = readBody(req);
    const purpose = PURPOSES[body.purpose] ? body.purpose : "membership";
    const cfg = PURPOSES[purpose];
    const amount = Math.max(1, Number(process.env[cfg.envAmount] || cfg.fallback));
    const senderInvoiceNo =
      cfg.prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const callbackUrl =
      "https://" + host + "/api/qpay/callback?sender_invoice_no=" + senderInvoiceNo;

    const r = await qpayFetch("/invoice", {
      method: "POST",
      body: {
        invoice_code: process.env.QPAY_INVOICE_CODE,
        sender_invoice_no: senderInvoiceNo,
        invoice_receiver_code: "terminal",
        invoice_description: cfg.description + " " + senderInvoiceNo,
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
