export type ProformaRow = {
  nombre: string;
  sku: string;
  prov: string;
  img: string | null;
  qty: number;
  unitMoneda: number | null;
  totalMoneda: number | null;
  cbmTotal: number;
  lote: string | null;
};

export type ProformaData = {
  ordenRec: Record<string, unknown>;
  moneda: string;
  simbolo: string;
  rows: ProformaRow[];
  invalidCostSkus: string[];
  hasInvalidCommercialCosts: boolean;
};

export type ProformaQueryError = { message: string };

export type ProformaDataSource = {
  getOrder: (
    orderId: string,
  ) => Promise<{ data: Record<string, unknown> | null; error: ProformaQueryError | null }>;
  getItems: (
    orderId: string,
  ) => Promise<{ data: Record<string, unknown>[] | null; error: ProformaQueryError | null }>;
};

export type ProformaLoadResult =
  | { ok: true; data: ProformaData }
  | {
      ok: false;
      status: 404 | 500;
      code: "ORDER_NOT_FOUND" | "PROFORMA_DATA_QUERY_FAILED";
      error: string;
    };

export type ProformaVersionPreparation =
  | {
      ok: true;
      data: ProformaData;
      htmlContent: string;
    }
  | Exclude<ProformaLoadResult, { ok: true }>
  | {
      ok: false;
      status: 422;
      code: "EMPTY_ORDER_ITEMS" | "MISSING_COMMERCIAL_COSTS";
      error: string;
      skus?: string[];
    };

const MONEDA_SIMBOLO: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CNY: "¥",
};
const MONEDAS_VALIDAS = new Set(["USD", "EUR", "GBP", "CNY"]);

function imagenUrl(item: Record<string, unknown>): string | null {
  const product = item["productos"] as Record<string, unknown> | null;
  const detail = product?.["producto_detalle"];
  if (Array.isArray(detail)) {
    return (
      ((detail[0] as Record<string, unknown> | undefined)?.["imagen_url"] as
        | string
        | null
        | undefined) ?? null
    );
  }
  return (
    ((detail as Record<string, unknown> | null)?.["imagen_url"] as
      | string
      | null
      | undefined) ?? null
  );
}

function numericValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveUnitCost(
  item: Record<string, unknown>,
  currency: string,
): number | null {
  const commercialCost = numericValue(item["coste_unitario_moneda"]);
  const legacyUsdCost = numericValue(item["coste_unitario_usd"]);
  const legacyEurCost = numericValue(item["coste_unitario_eur"]);

  if (commercialCost != null) return commercialCost;
  if (currency === "USD") return legacyUsdCost;
  if (currency === "EUR") return legacyEurCost;
  return null;
}

/**
 * Carga una única instantánea de orden + líneas. Los errores de Supabase se
 * conservan como resultado discriminado: nunca se interpretan como orden
 * inexistente ni como una lista vacía.
 */
export async function loadProformaData(
  source: ProformaDataSource,
  orderId: string,
): Promise<ProformaLoadResult> {
  const orderResult = await source.getOrder(orderId);
  if (orderResult.error) {
    return {
      ok: false,
      status: 500,
      code: "PROFORMA_DATA_QUERY_FAILED",
      error: `No se pudo consultar la orden para la proforma: ${orderResult.error.message}`,
    };
  }
  if (!orderResult.data) {
    return {
      ok: false,
      status: 404,
      code: "ORDER_NOT_FOUND",
      error: "Orden no encontrada",
    };
  }

  const itemsResult = await source.getItems(orderId);
  if (itemsResult.error) {
    return {
      ok: false,
      status: 500,
      code: "PROFORMA_DATA_QUERY_FAILED",
      error: `No se pudieron consultar las líneas de la proforma: ${itemsResult.error.message}`,
    };
  }

  const order = orderResult.data;
  const currencyRaw = String(order["moneda_compra"] ?? "USD").toUpperCase();
  const moneda = MONEDAS_VALIDAS.has(currencyRaw) ? currencyRaw : "USD";
  const simbolo = MONEDA_SIMBOLO[moneda] ?? moneda;

  const rows: ProformaRow[] = (itemsResult.data ?? []).map((item) => {
    const product = item["productos"] as Record<string, unknown> | null;
    const supplier = item["proveedores"] as Record<string, unknown> | null;
    const unitMoneda = resolveUnitCost(item, moneda);
    const quantity = Number(item["cantidad"] ?? 0);
    const calculatedTotal =
      unitMoneda != null &&
      Number.isFinite(unitMoneda) &&
      unitMoneda > 0
        ? unitMoneda * quantity
        : null;
    const totalMoneda =
      calculatedTotal != null && Number.isFinite(calculatedTotal)
        ? calculatedTotal
        : null;

    return {
      nombre: (product?.["nombre"] as string | null) ?? "—",
      sku: (product?.["sku"] as string | null) ?? "",
      prov: (supplier?.["nombre"] as string | null) ?? "—",
      img: imagenUrl(item),
      qty: quantity,
      unitMoneda,
      totalMoneda,
      cbmTotal: Number(item["cbm_total"] ?? 0),
      lote: item["lote_producto"] ? String(item["lote_producto"]) : null,
    };
  });

  const invalidCostSkus = rows
    .filter(
      (row) =>
        row.unitMoneda == null ||
        !Number.isFinite(row.unitMoneda) ||
        row.unitMoneda <= 0 ||
        row.totalMoneda == null ||
        !Number.isFinite(row.totalMoneda),
    )
    .map((row) => row.sku || row.nombre || "(sin SKU)");

  return {
    ok: true,
    data: {
      ordenRec: order,
      moneda,
      simbolo,
      rows,
      invalidCostSkus,
      hasInvalidCommercialCosts: invalidCostSkus.length > 0,
    },
  };
}

/**
 * Prepara la versión con una única carga. Esta es la frontera previa a la RPC:
 * si el resultado no es `ok`, el handler no debe persistir nada.
 */
export async function prepareProformaVersion(
  source: ProformaDataSource,
  orderId: string,
): Promise<ProformaVersionPreparation> {
  const loaded = await loadProformaData(source, orderId);
  if (loaded.ok === false) return loaded;

  if (loaded.data.rows.length === 0) {
    return {
      ok: false,
      status: 422,
      code: "EMPTY_ORDER_ITEMS",
      error: "No se puede generar la proforma: la orden no contiene líneas.",
    };
  }

  if (loaded.data.hasInvalidCommercialCosts) {
    return {
      ok: false,
      status: 422,
      code: "MISSING_COMMERCIAL_COSTS",
      error: `No se puede generar la proforma: faltan costes comerciales válidos en ${loaded.data.invalidCostSkus.length} línea(s) (${loaded.data.invalidCostSkus.join(", ")}). Completa costes positivos y finitos antes de generar una nueva versión.`,
      skus: loaded.data.invalidCostSkus,
    };
  }

  return {
    ok: true,
    data: loaded.data,
    htmlContent: renderProformaHtml(loaded.data, orderId),
  };
}

function fmt(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function fmtAmount(symbol: string, amount: number | null): string {
  return amount != null ? `${symbol}${fmt(amount)}` : "Coste pendiente";
}

/**
 * Render puro: el HTML se deriva exclusivamente de la misma instantánea que
 * el handler validó. No consulta Supabase ni vuelve a resolver costes.
 */
export function renderProformaHtml(data: ProformaData, orderId: string): string {
  const {
    ordenRec,
    moneda,
    simbolo,
    rows,
    invalidCostSkus,
    hasInvalidCommercialCosts,
  } = data;

  const grandTotalMoneda = hasInvalidCommercialCosts
    ? null
    : rows.reduce((sum, row) => sum + (row.totalMoneda ?? 0), 0);
  const grandTotalUnits = rows.reduce((sum, row) => sum + row.qty, 0);
  const grandTotalCbm = rows.reduce((sum, row) => sum + row.cbmTotal, 0);
  const depositPercent = Number(ordenRec["deposito_porcentaje"] ?? 30);
  const balanceTerms = String(
    ordenRec["balance_condiciones_texto"] ??
      "The balance will be paid 10 days before the vessel arrives at the port",
  );
  const depositAmount =
    grandTotalMoneda != null
      ? grandTotalMoneda * (depositPercent / 100)
      : null;
  const balanceAmount =
    grandTotalMoneda != null && depositAmount != null
      ? grandTotalMoneda - depositAmount
      : null;
  const today = new Date().toLocaleDateString("en-GB");
  const orderNumber = String(ordenRec["numero_orden"] ?? orderId);
  const agentNumber = ordenRec["numero_pedido_agente"]
    ? String(ordenRec["numero_pedido_agente"])
    : null;

  const rowsHtml = rows
    .map(
      (row) => `
    <tr>
      <td class="img-cell">
        ${
          row.img
            ? `<img src="${esc(row.img)}" alt="${esc(row.nombre)}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;">`
            : `<div class="no-img">—</div>`
        }
      </td>
      <td>
        <strong>${esc(row.nombre)}</strong><br>
        <small style="color:#888">SKU: ${esc(row.sku)}</small><br>
        <small style="color:#aaa">${esc(row.prov)}</small>
        ${row.lote ? `<br><small style="color:#64748b">Batch: ${esc(row.lote)}</small>` : ""}
      </td>
      <td class="center">${Number.isFinite(row.qty) ? row.qty.toLocaleString("en-US") : "—"}</td>
      <td class="right">${row.unitMoneda != null && Number.isFinite(row.unitMoneda) && row.unitMoneda > 0 ? `${simbolo}${fmt(row.unitMoneda)}` : "—"}</td>
      <td class="right"><strong>${row.totalMoneda != null && Number.isFinite(row.totalMoneda) ? `${simbolo}${fmt(row.totalMoneda)}` : "—"}</strong></td>
      <td class="right">${Number.isFinite(row.cbmTotal) ? fmt(row.cbmTotal) : "—"}</td>
    </tr>`,
    )
    .join("");

  const warningHtml = hasInvalidCommercialCosts
    ? `<div class="cost-warning">⚠ Faltan costes comerciales válidos en ${invalidCostSkus.length} línea(s): ${esc(invalidCostSkus.join(", "))}. Los totales, el depósito y el balance no se muestran hasta completar los costes.</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proforma Invoice – ${esc(orderNumber)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #222; background: #fff; padding: 40px; }
  .no-print { margin-bottom: 20px; display: flex; gap: 12px; }
  .no-print button { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .btn-print { background: #1d4ed8; color: #fff; }
  .btn-close { background: #e2e8f0; color: #444; }
  .cost-warning { background: #fef2f2; border-left: 4px solid #dc2626; color: #991b1b; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 12px; font-weight: 600; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #1e293b; padding-bottom: 16px; }
  .company { font-size: 16px; font-weight: 700; color: #1e293b; line-height: 1.4; }
  .company small { display: block; font-size: 11px; font-weight: 400; color: #64748b; margin-top: 4px; max-width: 280px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 24px; font-weight: 700; color: #1d4ed8; }
  .doc-title p { font-size: 11px; color: #888; margin-top: 2px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  .party { background: #f8fafc; border-radius: 8px; padding: 16px; }
  .party-title { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #64748b; font-weight: 700; margin-bottom: 8px; }
  .party-info { font-size: 12px; line-height: 1.6; color: #1e293b; }
  .party-info strong { display: block; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
  .info-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; background: #f8fafc; border-radius: 8px; padding: 16px; }
  .info-block label { font-size: 10px; text-transform: uppercase; letter-spacing: .6px; color: #888; display: block; margin-bottom: 3px; }
  .info-block span { font-weight: 600; color: #1e293b; font-size: 13px; }
  .payment-terms { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 24px; border-radius: 6px; }
  .payment-terms h3 { font-size: 12px; font-weight: 700; color: #92400e; margin-bottom: 8px; text-transform: uppercase; }
  .payment-terms p { font-size: 12px; color: #78350f; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #1e293b; color: #fff; padding: 10px 8px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
  tbody tr { border-bottom: 1px solid #e2e8f0; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  td { padding: 10px 8px; vertical-align: middle; font-size: 12px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .img-cell { width: 60px; }
  .no-img { width: 50px; height: 50px; background: #e2e8f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 10px; }
  tfoot td { font-weight: 700; background: #f0f9ff; padding: 10px 8px; font-size: 13px; }
  .totals { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 32px; padding: 16px; background: #f0f9ff; border-radius: 8px; margin-bottom: 24px; }
  .total-item label { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #666; display: block; }
  .total-item span { font-size: 20px; font-weight: 800; color: #1d4ed8; }
  .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 60px; }
  .sig-block { border-top: 2px solid #1e293b; padding-top: 8px; text-align: center; }
  .sig-block p { font-size: 11px; color: #888; margin-bottom: 40px; }
  .sig-line { border-bottom: 1px solid #cbd5e1; margin: 20px auto 8px; width: 80%; }
  .sig-label { font-size: 10px; color: #94a3b8; }
  .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #bbb; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 20px; }
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="btn-print" onclick="window.print()">🖨 Print / Save as PDF</button>
  <button class="btn-close" onclick="window.close()">✕ Close</button>
</div>
${warningHtml}
<div class="header">
  <div class="company">
    Yubei Enterprise Limited
    <small>UNIT 1406A, 14F, THE BELGIAN BANK BUILDING<br>NOS.721-725 NATHAN ROAD, KOWLOON, HONG KONG</small>
  </div>
  <div class="doc-title">
    <h1>PROFORMA INVOICE</h1>
    <p>Date: ${today}</p>
    <p style="margin-top:6px;font-size:14px;font-weight:700;color:#1e293b">Order: ${esc(orderNumber)}</p>
    ${agentNumber ? `<p style="font-size:12px;color:#64748b">Agent PO: ${esc(agentNumber)}</p>` : ""}
  </div>
</div>
<div class="parties">
  <div class="party">
    <div class="party-title">Seller</div>
    <div class="party-info">
      <strong>Yubei Enterprise Limited</strong>
      UNIT 1406A, 14F, THE BELGIAN BANK BUILDING<br>
      NOS.721-725 NATHAN ROAD, KOWLOON<br>
      HONG KONG
    </div>
  </div>
  <div class="party">
    <div class="party-title">Buyer</div>
    <div class="party-info">
      <strong>mpulsami S.L.</strong>
      CIF: B01934546<br>
      C/San Jose 55 Local<br>
      Almoradi 03160-ES
    </div>
  </div>
</div>
<div class="info-grid">
  <div class="info-block"><label>FOB Port</label><span>${esc(String(ordenRec["fob_puerto"] ?? "—"))}</span></div>
  <div class="info-block"><label>Destination</label><span>${esc(String(ordenRec["destino"] ?? "—"))}</span></div>
  <div class="info-block"><label>Currency</label><span>${esc(moneda)}</span></div>
  <div class="info-block"><label>ETD</label><span>${esc(String(ordenRec["etd"] ?? "—"))}</span></div>
  <div class="info-block"><label>ETA</label><span>${esc(String(ordenRec["eta"] ?? "—"))}</span></div>
</div>
<div class="payment-terms">
  <h3>Payment Terms</h3>
  <p><strong>Deposit (${esc(moneda)}):</strong> ${depositPercent}% — ${fmtAmount(simbolo, depositAmount)}</p>
  <p><strong>Balance (${esc(moneda)}):</strong> ${100 - depositPercent}% — ${fmtAmount(simbolo, balanceAmount)}</p>
  <p style="margin-top:8px">${esc(balanceTerms)}</p>
</div>
<table>
  <thead>
    <tr>
      <th colspan="2">Product Description</th>
      <th class="center">Quantity</th>
      <th class="right">Unit Price (${esc(moneda)})</th>
      <th class="right">Line Total (${esc(moneda)})</th>
      <th class="right">CBM</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>
    <tr>
      <td colspan="2" style="text-align:right;font-size:11px;color:#666;">TOTALS</td>
      <td class="center">${grandTotalUnits.toLocaleString("en-US")}</td>
      <td></td>
      <td class="right">${fmtAmount(simbolo, grandTotalMoneda)}</td>
      <td class="right">${fmt(grandTotalCbm)}</td>
    </tr>
  </tfoot>
</table>
<div class="totals">
  <div class="total-item"><label>Total Units</label><span>${grandTotalUnits.toLocaleString("en-US")}</span></div>
  <div class="total-item"><label>Total CBM</label><span>${fmt(grandTotalCbm)}</span></div>
  <div class="total-item"><label>Total ${esc(moneda)}</label><span>${fmtAmount(simbolo, grandTotalMoneda)}</span></div>
  <div class="total-item"><label>Deposit (${esc(moneda)})</label><span>${fmtAmount(simbolo, depositAmount)}</span></div>
  <div class="total-item"><label>Balance (${esc(moneda)})</label><span>${fmtAmount(simbolo, balanceAmount)}</span></div>
</div>
<div class="signature">
  <div class="sig-block"><p>SELLER SIGNATURE</p><div class="sig-line"></div><p class="sig-label">Name &amp; Date</p></div>
  <div class="sig-block"><p>BUYER SIGNATURE</p><div class="sig-line"></div><p class="sig-label">Name &amp; Date</p></div>
</div>
<div class="footer">Proforma Invoice generated automatically · ${today} · mpulsami ERP</div>
</body>
</html>`;
}
