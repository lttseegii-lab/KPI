/* Нэхэмжлэл төлөгдсөн эсэхийг QPay-ийн payment/check-ээр БАТАЛГААЖУУЛЖ шалгана.
   Клиент QR харуулж байх хугацаандаа энэ эцсийн цэгийг тогтмол асууна. */
"use strict";

const { qpayFetch, sendJson, sendError } = require("./_lib.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const invoiceId = url.searchParams.get("invoice_id") || "";
    if (!UUID_RE.test(invoiceId)) {
      return sendJson(res, 400, { error: "invoice_id буруу байна" });
    }

    const r = await qpayFetch("/payment/check", {
      method: "POST",
      body: {
        object_type: "INVOICE",
        object_id: invoiceId,
        offset: { page_number: 1, page_limit: 100 },
      },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error("Төлбөр шалгаж чадсангүй");
      err.statusCode = 502;
      throw err;
    }
    const rows = Array.isArray(d.rows) ? d.rows : [];
    const paidRow = rows.find((x) => x && x.payment_status === "PAID");
    sendJson(res, 200, {
      paid: !!paidRow,
      payment_id: paidRow ? String(paidRow.payment_id || "") : "",
      amount: Number((paidRow && paidRow.payment_amount) || d.paid_amount || 0),
    });
  } catch (err) {
    sendError(res, err);
  }
};
