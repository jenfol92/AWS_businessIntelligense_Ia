/**
 * Modulo   : orders
 * Archivo  : app/api/orders/[id]/confirm/route.ts
 * Que hace : POST — confirma una orden de compra (borrador -> confirmado).
 *            Actualiza costes de lineas, ETA, lead times y condiciones de pago.
 * No debe  : Abrir ordenes ya confirmadas ni gestionar stock/contenedores.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { confirmOrder } from "@/modules/orders/repositories/ordersRepository";
import { syncSupplierPaymentsForOrder } from "@/modules/finance/services/syncSupplierPaymentsForOrder";

type Params = { params: { id: string } };

/**
 * POST /api/orders/[id]/confirm
 *
 * Body:
 * @param eta                       - Fecha ETA calculada 'YYYY-MM-DD' (requerido)
 * @param etd                       - Fecha ETD (opcional)
 * @param eta_real                  - ETA real actualizada (opcional)
 * @param lead_time_produccion      - Dias de produccion
 * @param lead_time_transito        - Dias de transito maritimo
 * @param numero_pedido_agente      - Referencia del agente
 * @param moneda_compra             - Moneda de compra (USD, EUR, CNY, GBP, ...)
 * @param tipo_cambio_moneda_eur    - Tipo de cambio moneda → EUR (1 unidad = X EUR)
 * @param tipo_cambio_usd_eur       - Compatibilidad: solo si moneda_compra = USD
 * @param deposito_porcentaje       - Porcentaje de deposito (default 30)
 * @param balance_dias_antes_eta    - Dias antes de ETA para pagar balance (default 10)
 * @param balance_condiciones_texto - Texto libre de condiciones de pago
 * @param items_costes              - Array de costes por linea: { item_id, coste_unitario_moneda, coste_unitario_eur, coste_unitario_usd?, lote_producto }
 */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: {
    eta?: string;
    etd?: string | null;
    eta_real?: string | null;
    lead_time_produccion?: number | null;
    lead_time_transito?: number | null;
    numero_pedido_agente?: string | null;
    agente_id?: string | null;
    moneda_compra?: string | null;
    tipo_cambio_moneda_eur?: number | null;
    tipo_cambio_usd_eur?: number | null;
    deposito_porcentaje?: number;
    balance_dias_antes_eta?: number;
    balance_condiciones_texto?: string;
    items_costes?: Array<{
      item_id: string;
      coste_unitario_moneda?: number | null;
      coste_unitario_usd?: number | null;
      coste_unitario_eur?: number | null;
      moneda_coste?: string | null;
      lote_producto?: string | null;
    }>;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  if (!body.eta) {
    return NextResponse.json({ ok: false, error: "El campo eta es obligatorio." }, { status: 400 });
  }

  try {
    const orden = await confirmOrder(params.id, {
      eta: body.eta,
      etd: body.etd,
      eta_real: body.eta_real,
      lead_time_produccion: body.lead_time_produccion,
      lead_time_transito: body.lead_time_transito,
      numero_pedido_agente: body.numero_pedido_agente,
      agente_id: body.agente_id,
      moneda_compra: body.moneda_compra,
      tipo_cambio_moneda_eur: body.tipo_cambio_moneda_eur,
      tipo_cambio_usd_eur: body.tipo_cambio_usd_eur,
      deposito_porcentaje: body.deposito_porcentaje ?? 30,
      balance_dias_antes_eta: body.balance_dias_antes_eta ?? 10,
      balance_condiciones_texto: body.balance_condiciones_texto,
      items_costes: body.items_costes,
    });

    try {
      await syncSupplierPaymentsForOrder(params.id);
    } catch (syncError) {
      console.error("syncSupplierPaymentsForOrder:", syncError);
    }

    return NextResponse.json({ ok: true, orden });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error confirmando la orden.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
