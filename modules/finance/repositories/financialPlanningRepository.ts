import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { FinancePlanningQuery, FinancePlanningRawData } from "../types/planning.types";

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

function lastDayOfWindow(fromMonth: string, months: number): string {
  const start = new Date(`${fromMonth}-01T00:00:00`);
  const end = addMonths(start, months);
  end.setDate(0);
  return end.toISOString().slice(0, 10);
}

/**
 * Lee datos crudos para la planificacion financiera.
 * Las reglas de negocio se aplican en el servicio, no aqui.
 */
export async function findFinancialPlanningData(
  query: FinancePlanningQuery,
): Promise<FinancePlanningRawData> {
  const supabase = createSupabaseRouteClient();
  const today = new Date();
  const fromMonth = query.fromMonth ?? today.toISOString().slice(0, 7);
  const months = query.months ?? 6;
  const fromDate = firstDayOfMonth(fromMonth);
  const toDate = lastDayOfWindow(fromMonth, months);

  const [
    containersResult,
    supplierPaymentsResult,
    creditLinesResult,
    repaymentGroupsResult,
    cashResult,
    incomeResult,
    settingsResult,
  ] = await Promise.all([
    supabase
      .from("contenedores")
      .select(
        `id, identificador_embarque, tipo_contenedor, transitario,
         fecha_salida, fecha_eta_estimada, estado,
         pago_30_completado, pago_70_completado,
         fecha_pago_reserva, fecha_pago_final,
         costo_flete_total_eur,
         tasa_cambio_usd_eur, tasa_cambio_pago_30, tasa_cambio_pago_70,
         comision_bancaria_eur, gastos_llegada_puerto_eur, costo_transito_total_eur,
         contenedor_ordenes(
           ordenes_compra(
             id, numero_orden, numero_pedido_agente, agente_id,
             estado, fecha_orden, eta, etd,
             coste_total_usd, coste_total_eur,
             moneda_compra, tipo_cambio_moneda_eur, tipo_cambio_usd_eur,
             deposito_porcentaje, balance_dias_antes_eta,
             fecha_pago_balance, fob_puerto, destino,
             agentes_compra(contacto),
             orden_items(cantidad, coste_unitario_moneda)
           )
         )`,
      )
      .or(
        [
          `fecha_eta_estimada.gte.${fromDate}`,
          `fecha_salida.gte.${fromDate}`,
        ].join(","),
      ),
    supabase
      .from("finance_supplier_payments")
      .select(
        `*,
         ordenes_compra(
           id, numero_orden, numero_pedido_agente, estado,
           moneda_compra, tipo_cambio_moneda_eur, coste_total_eur, coste_total_usd,
           deposito_porcentaje,
           orden_items(cantidad, coste_unitario_moneda),
           agentes_compra(contacto)
         ),
         contenedores(id, identificador_embarque, tipo_contenedor)`,
      )
      .or(`due_date.gte.${fromDate},due_date.lte.${toDate},due_date.is.null`),
    supabase
      .from("finance_credit_lines")
      .select("*")
      .order("priority", { ascending: true, nullsFirst: false }),
    supabase
      .from("finance_credit_line_repayment_groups")
      .select("*")
      .in("status", ["open", "partially_paid"])
      .order("due_date", { ascending: true }),
    supabase
      .from("finance_cash_accounts")
      .select("*")
      .order("name", { ascending: true }),
    supabase
      .from("finance_amazon_income_forecasts")
      .select("*")
      .gte("forecast_date", fromDate)
      .lte("forecast_date", toDate)
      .order("forecast_date", { ascending: true }),
    supabase
      .from("finance_settings")
      .select("*")
      .in("key", ["planned_usd_eur_rate"]),
  ]);

  for (const result of [
    containersResult,
    supplierPaymentsResult,
    creditLinesResult,
    repaymentGroupsResult,
    cashResult,
    incomeResult,
    settingsResult,
  ]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  return {
    containers: (containersResult.data ?? []) as Record<string, unknown>[],
    supplierPayments: (supplierPaymentsResult.data ?? []) as Record<string, unknown>[],
    creditLines: (creditLinesResult.data ?? []) as Record<string, unknown>[],
    creditLineRepaymentGroups: (repaymentGroupsResult.data ?? []) as Record<string, unknown>[],
    cashAccounts: (cashResult.data ?? []) as Record<string, unknown>[],
    amazonIncomeForecasts: (incomeResult.data ?? []) as Record<string, unknown>[],
    settings: (settingsResult.data ?? []) as Record<string, unknown>[],
  };
}
