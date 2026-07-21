/**

 * Módulo   : orders

 * Archivo  : app/api/orders/[id]/proforma/route.ts

 * Qué hace : GET — Genera el HTML de la Proforma Invoice para una orden.

 *            Usa exclusivamente la moneda comercial guardada en la orden.

 */



import { NextResponse }              from "next/server";

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";



type Params = { params: { id: string } };



const MONEDA_SIMBOLO: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CNY: "¥" };
const MONEDAS_VALIDAS = new Set(["USD", "EUR", "GBP", "CNY"]);



/** Renderiza una nueva proforma desde el estado comercial congelado de la orden. */

async function renderCurrentProforma(req: Request, { params }: Params) {

  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return new Response("No autorizado", { status: 401 });



  const { data: orden } = await supabase

    .from("ordenes_compra")

    .select("*")

    .eq("id", params.id)

    .single();



  if (!orden) {

    return NextResponse.json({ ok: false, error: "Orden no encontrada" }, { status: 404 });

  }



  const ordenRec = orden as Record<string, unknown>;



  // Moneda comercial congelada en la orden.

  const monedaRaw = (

    ordenRec["moneda_compra"] as string | null ?? "USD"

  ).toUpperCase();
  const moneda = MONEDAS_VALIDAS.has(monedaRaw) ? monedaRaw : "USD";



  const simbolo = MONEDA_SIMBOLO[moneda] ?? moneda;



  const { data: items } = await supabase

    .from("orden_items")

    .select("*, productos(sku, nombre, producto_detalle(imagen_url)), proveedores(nombre), lote_producto")

    .eq("orden_id", params.id);



  function fmt(n: number): string {

    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  }

  function esc(s: string): string {

    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  }

  function imagenUrl(it: Record<string, unknown>): string | null {

    const prod = it["productos"] as Record<string, unknown> | null;

    const pd   = prod?.["producto_detalle"];

    if (Array.isArray(pd)) return (pd[0] as Record<string, unknown>)?.["imagen_url"] as string ?? null;

    return (pd as Record<string, unknown> | null)?.["imagen_url"] as string ?? null;

  }



  /** Resuelve el precio unitario únicamente en la moneda comercial. */

  function resolveUnitCost(it: Record<string, unknown>): number | null {

    const unitMonedaStored = it["coste_unitario_moneda"] != null

      ? Number(it["coste_unitario_moneda"])

      : null;

    const unitUsd = it["coste_unitario_usd"] != null ? Number(it["coste_unitario_usd"]) : null;

    let unitMoneda = unitMonedaStored;

    if (unitMoneda == null) {

      if (moneda === "USD") unitMoneda = unitUsd;
    }

    return unitMoneda;

  }



  const rows = (items ?? []).map((it: Record<string, unknown>) => {

    const prod = it["productos"] as Record<string, unknown> | null;

    const prov = it["proveedores"] as Record<string, unknown> | null;

    const unitMoneda = resolveUnitCost(it);

    const cantidad = Number(it["cantidad"] ?? 0);

    const totalMoneda = unitMoneda != null ? unitMoneda * cantidad : null;

    return {

      nombre: prod?.["nombre"] as string ?? "—",

      sku:    prod?.["sku"]    as string ?? "",

      prov:   prov?.["nombre"] as string ?? "—",

      img:    imagenUrl(it),

      qty:    cantidad,

      unitMoneda,

      totalMoneda,

      cbmTotal: Number(it["cbm_total"] ?? 0),

      lote: it["lote_producto"] ? String(it["lote_producto"]) : null,

    };

  });



  const grandTotalMoneda = rows.reduce((s, r) => s + (r.totalMoneda ?? 0), 0);

  const grandTotalUnits  = rows.reduce((s, r) => s + r.qty, 0);

  const grandTotalCbm    = rows.reduce((s, r) => s + r.cbmTotal, 0);



  const depositoPct        = Number(ordenRec["deposito_porcentaje"] ?? 30);

  const balanceCondiciones = String(

    ordenRec["balance_condiciones_texto"]

    ?? "The balance will be paid 10 days before the vessel arrives at the port",

  );

  const depositAmount  = grandTotalMoneda * (depositoPct / 100);

  const balanceAmount  = grandTotalMoneda - depositAmount;

  const today         = new Date().toLocaleDateString("en-GB");

  const etdDate       = String(ordenRec["etd"] ?? "—");

  const etaDate       = String(ordenRec["eta"] ?? "—");

  const fobPuerto     = String(ordenRec["fob_puerto"] ?? "—");

  const destino       = String(ordenRec["destino"] ?? "—");

  const orderNumber   = String(ordenRec["numero_orden"] ?? params.id);

  const agentNumber   = ordenRec["numero_pedido_agente"]

    ? String(ordenRec["numero_pedido_agente"])

    : null;



  const rowsHtml = rows.map((r) => {
    return `

    <tr>

      <td class="img-cell">

        ${r.img

          ? `<img src="${r.img}" alt="${esc(r.nombre)}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;">`

          : `<div class="no-img">—</div>`

        }

      </td>

      <td>

        <strong>${esc(r.nombre)}</strong><br>

        <small style="color:#888">SKU: ${esc(r.sku)}</small><br>

        <small style="color:#aaa">${esc(r.prov)}</small>

        ${r.lote ? `<br><small style="color:#64748b">Batch: ${esc(r.lote)}</small>` : ""}

      </td>

      <td class="center">${r.qty.toLocaleString("en-US")}</td>

      <td class="right">${r.unitMoneda != null ? `${simbolo}${fmt(r.unitMoneda)}` : "—"}</td>

      <td class="right"><strong>${r.totalMoneda != null ? `${simbolo}${fmt(r.totalMoneda)}` : "—"}</strong></td>

      <td class="right">${fmt(r.cbmTotal)}</td>

    </tr>`;

  }).join("");



  const html = `<!DOCTYPE html>

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

  <div class="info-block">

    <label>FOB Port</label>

    <span>${esc(fobPuerto)}</span>

  </div>

  <div class="info-block">

    <label>Destination</label>

    <span>${esc(destino)}</span>

  </div>

  <div class="info-block">

    <label>Currency</label>

    <span>${esc(moneda)}</span>

  </div>

  <div class="info-block">

    <label>ETD</label>

    <span>${esc(etdDate)}</span>

  </div>

  <div class="info-block">

    <label>ETA</label>

    <span>${esc(etaDate)}</span>

  </div>

</div>



<div class="payment-terms">

  <h3>Payment Terms</h3>

  <p><strong>Deposit (${esc(moneda)}):</strong> ${depositoPct}% — ${simbolo}${fmt(depositAmount)}</p>

  <p><strong>Balance (${esc(moneda)}):</strong> ${100 - depositoPct}% — ${simbolo}${fmt(balanceAmount)}</p>

  <p style="margin-top:8px">${esc(balanceCondiciones)}</p>

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

      <td class="right">${simbolo}${fmt(grandTotalMoneda)}</td>

      <td class="right">${fmt(grandTotalCbm)}</td>

    </tr>

  </tfoot>

</table>



<div class="totals">

  <div class="total-item">

    <label>Total Units</label>

    <span>${grandTotalUnits.toLocaleString("en-US")}</span>

  </div>

  <div class="total-item">

    <label>Total CBM</label>

    <span>${fmt(grandTotalCbm)}</span>

  </div>

  <div class="total-item">

    <label>Total ${esc(moneda)}</label>

    <span>${simbolo}${fmt(grandTotalMoneda)}</span>

  </div>

  <div class="total-item">

    <label>Deposit (${esc(moneda)})</label>

    <span>${simbolo}${fmt(depositAmount)}</span>

  </div>

  <div class="total-item">

    <label>Balance (${esc(moneda)})</label>

    <span>${simbolo}${fmt(balanceAmount)}</span>

  </div>

</div>



<div class="signature">

  <div class="sig-block">

    <p>SELLER SIGNATURE</p>

    <div class="sig-line"></div>

    <p class="sig-label">Name &amp; Date</p>

  </div>

  <div class="sig-block">

    <p>BUYER SIGNATURE</p>

    <div class="sig-line"></div>

    <p class="sig-label">Name &amp; Date</p>

  </div>

</div>



<div class="footer">

  Proforma Invoice generated automatically · ${today} · mpulsami ERP

</div>



</body>

</html>`;



  return new Response(html, {

    headers: { "Content-Type": "text/html; charset=utf-8" },

  });

}

/** Abre una versión existente; nunca genera una nueva proforma. */
export async function GET(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const requestedVersion = new URL(req.url).searchParams.get("version");
  let query = supabase
    .from("order_proforma_versions")
    .select("html_content, version")
    .eq("orden_id", params.id);

  if (requestedVersion) {
    const parsedVersion = Number(requestedVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
      return NextResponse.json(
        { ok: false, error: "Versión de proforma inválida" },
        { status: 400 },
      );
    }
    query = query.eq("version", parsedVersion);
  } else {
    query = query.order("version", { ascending: false }).limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "La orden no tiene una proforma generada" },
      { status: 404 },
    );
  }

  return new Response(String(data.html_content), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Proforma-Version": String(data.version),
    },
  });
}

/**
 * Genera explícitamente una nueva versión no firmada.
 * Si existe proforma firmada exige confirmación expresa, pero nunca la sustituye.
 */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: { confirm_signed?: boolean } = {};
  try {
    body = (await req.json()) as { confirm_signed?: boolean };
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("ordenes_compra")
    .select("id, proforma_firmada_url")
    .eq("id", params.id)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ ok: false, error: orderError.message }, { status: 400 });
  }
  if (!order) {
    return NextResponse.json({ ok: false, error: "Orden no encontrada" }, { status: 404 });
  }
  if (order.proforma_firmada_url && body.confirm_signed !== true) {
    return NextResponse.json(
      {
        ok: false,
        code: "SIGNED_PROFORMA_EXISTS",
        error:
          "Existe una proforma firmada. Confirma expresamente la creación de una nueva versión no firmada.",
      },
      { status: 409 },
    );
  }

  const rendered = await renderCurrentProforma(req, { params });
  if (!rendered.ok) return rendered;
  const htmlContent = await rendered.text();

  const { data: createdVersion, error: versionError } = await supabase.rpc(
    "create_order_proforma_version",
    {
      p_order_id: params.id,
      p_html_content: htmlContent,
    },
  );

  if (versionError) {
    return NextResponse.json({ ok: false, error: versionError.message }, { status: 400 });
  }

  const versionRow = Array.isArray(createdVersion)
    ? createdVersion[0]
    : createdVersion;
  const version = Number(
    (versionRow as { version?: number } | null)?.version ?? 0,
  );
  if (!Number.isInteger(version) || version <= 0) {
    return NextResponse.json(
      { ok: false, error: "La RPC no devolvió una versión válida" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    version,
    url: `/api/orders/${encodeURIComponent(params.id)}/proforma?version=${version}`,
  });
}


