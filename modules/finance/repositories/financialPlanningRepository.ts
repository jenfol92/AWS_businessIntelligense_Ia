import { accountingDate } from "../utils/accountingDate";
import { readRecurringCalendar } from "./recurringPaymentsRepository";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import type { FinancePlanningQuery, FinancePlanningRawData } from "../types/planning.types";

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

function lastDayOfWindow(fromMonth: string, months: number): string {
  const start = new Date(`${fromMonth}-01T00:00:00Z`);
  const end = addMonths(start, months);
  end.setUTCDate(0);
  return end.toISOString().slice(0, 10);
}

const AMAZON_OBSERVATION_PAGE_SIZE = 1000;

function readSuccessfulSyncObservationAt(
  lastResult: unknown,
): string | null {
  if (!lastResult || typeof lastResult !== "object") return null;
  const observations = (lastResult as Record<string, unknown>).observations;
  if (!observations || typeof observations !== "object") return null;
  const observedAt = (observations as Record<string, unknown>).observedAt;
  return typeof observedAt === "string" && observedAt.length > 0 ? observedAt : null;
}

async function readLatestSuccessfulAmazonObservationAt() {
  const { data, error } = await supabaseAdmin
    .from("finance_amazon_sync_state")
    .select("status, last_result")
    .eq("sync_key", "amazon_financial_planning")
    .maybeSingle();
  if (error) return { data: null, error };
  if (!data) {
    return { data: null, error: null };
  }
  return {
    data: readSuccessfulSyncObservationAt(data.last_result),
    error: null,
  };
}

async function findCurrentAmazonTreasuryObservations() {
  const syncAtResult = await readLatestSuccessfulAmazonObservationAt();
  if (syncAtResult.error) return { data: null, error: syncAtResult.error };
  const snapshotAt = syncAtResult.data;
  if (!snapshotAt) return { data: [], error: null };

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += AMAZON_OBSERVATION_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("finance_amazon_treasury_forecast_snapshots")
      .select("*")
      .eq("snapshot_at", snapshotAt)
      .in("economic_state", ["AVAILABLE", "DEFERRED", "PENDING_BANK"])
      .order("id", { ascending: false })
      .range(from, from + AMAZON_OBSERVATION_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < AMAZON_OBSERVATION_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
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
  const fromMonth = query.fromMonth ?? accountingDate(today).slice(0, 7);
  const months = query.months ?? 6;
  const fromDate = firstDayOfMonth(fromMonth);
  const toDate = lastDayOfWindow(fromMonth, months);

  const [
    containersResult,
    supplierPaymentsResult,
    creditLinesResult,
    repaymentGroupsResult,
    repaymentMovementsResult,
    legacyItemsResult,
    plannedMaturitiesResult,
    cashResult,
    incomeResult,
    observationResult,
    settingsResult,
    recurringResult,
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
             moneda_compra, planned_fx_foreign_per_eur,
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
           moneda_compra, planned_fx_foreign_per_eur,
           deposito_porcentaje,
           agentes_compra(contacto)
         ),
         contenedores(id, identificador_embarque, tipo_contenedor),
         finance_purchase_payment_allocations(
           allocated_amount_original,
           allocated_amount_eur,
           finance_purchase_payment_batches(
             id, status, paid_at, bank_reference, source_type,
             actual_fx_rate, actual_fx_foreign_per_eur, actual_amount_eur, bank_fee_eur, ff_fee_eur
           )
         )`,
      ),
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
      .from("finance_credit_line_repayments")
      .select("*,finance_credit_lines!inner(bank_name,line_name),finance_credit_line_repayment_groups(group_origin_type)")
      .eq("status", "posted")
      .gte("effective_date", fromDate)
      .lte("effective_date", toDate)
      .order("effective_date", { ascending: true }),
    supabase
      .from("finance_credit_line_legacy_regularization_items")
      .select("repayment_group_id,expected_interest_eur,expected_fees_eur"),
    supabase
      .from("finance_credit_line_planned_maturities")
      .select("*,finance_credit_lines!inner(bank_name,line_name)")
      .eq("status", "planned")
      .neq("source_type", "spreadsheet_schedule")
      .is("linked_repayment_group_id", null)
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
    findCurrentAmazonTreasuryObservations(),
    supabase
      .from("finance_settings")
      .select("*")
      .in("key", ["planned_usd_eur_rate", "minimum_operating_cash_reserve_eur", "amazon_expected_net_ratio", "amazon_transfer_request_weekdays", "amazon_bank_lag_days", "amazon_treasury_percentile", "amazon_min_history_samples"]),
    readRecurringCalendar(supabase, fromDate, toDate),
  ]);

  for (const result of [
    containersResult,
    supplierPaymentsResult,
    creditLinesResult,
    repaymentGroupsResult,
    repaymentMovementsResult,
    legacyItemsResult,
    plannedMaturitiesResult,
    cashResult,
    incomeResult,
    observationResult,
    settingsResult,
  ]) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  return {
    recurringPayments: recurringResult.rows,
    recurringPaymentsWarning: recurringResult.warning,
    containers: (containersResult.data ?? []) as Record<string, unknown>[],
    supplierPayments: (supplierPaymentsResult.data ?? []) as Record<string, unknown>[],
    creditLines: (creditLinesResult.data ?? []) as Record<string, unknown>[],
    creditLineRepaymentGroups: (repaymentGroupsResult.data ?? []) as Record<string, unknown>[],
    creditLineRepaymentMovements: (repaymentMovementsResult.data ?? []) as Record<string, unknown>[],
    creditLineLegacyRegularizationItems: (legacyItemsResult.data ?? []) as Record<string, unknown>[],
    creditLinePlannedMaturities: (plannedMaturitiesResult.data ?? []) as Record<string, unknown>[],
    cashAccounts: (cashResult.data ?? []) as Record<string, unknown>[],
    amazonIncomeForecasts: (incomeResult.data ?? []) as Record<string, unknown>[],
    amazonTreasuryObservations: (observationResult.data ?? []) as Record<string, unknown>[],
    settings: (settingsResult.data ?? []) as Record<string, unknown>[],
  };
}
