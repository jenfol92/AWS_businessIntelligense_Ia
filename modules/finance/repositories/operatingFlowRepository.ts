import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { AmazonIncomeInput, CreditLineRefinancingInput, OperatingTreasuryInput } from "../types/operatingFlow.types";

function fail(error: { message: string; code?: string | null; details?: string | null } | null) {
  if (error) throw new Error(JSON.stringify(error));
}

export async function refinanceCreditLineRpc(input: CreditLineRefinancingInput) {
  const client = createSupabaseRouteClient();
  const { data, error } = await client.rpc("finance_refinance_credit_line", {
    p_source_repayment_group_id: input.sourceRepaymentGroupId,
    p_funding_credit_line_id: input.fundingCreditLineId,
    p_effective_date: input.effectiveDate,
    p_principal_eur: input.principalEur,
    p_interest_eur: input.interestEur,
    p_fees_eur: input.feesEur,
    p_funding_manual_due_date: input.fundingManualDueDate ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function recordOperatingTreasuryRpc(input: OperatingTreasuryInput) {
  const client = createSupabaseRouteClient();
  const { data, error } = await client.rpc("finance_record_operating_treasury_operation", {
    p_cash_account_id: input.cashAccountId,
    p_operation_type: input.operationType,
    p_direction: input.direction,
    p_amount_eur: input.amountEur,
    p_effective_date: input.effectiveDate,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
  fail(error);
  return data as Record<string, unknown>;
}

export async function upsertAmazonIncome(input: AmazonIncomeInput) {
  const client = createSupabaseRouteClient();
  const { data, error } = await client.rpc("finance_upsert_amazon_income", {
    p_source_key:input.sourceKey,p_forecast_date:input.forecastDate,p_description:input.description,
    p_amount_eur:input.amountEur,p_status:input.status,p_marketplace:input.marketplace??null,
    p_cycle_start:input.cycleStart??null,p_cycle_end:input.cycleEnd??null,
    p_estimated_gross_eur:input.estimatedGrossEur??null,p_historical_net_ratio:input.historicalNetRatio??null,
    p_confirmed_amount_eur:input.confirmedAmountEur??null,p_notes:input.notes??null,
  });
  fail(error);
  return data;
}

export async function setOperatingCashAccountRpc(cashAccountId:string,enabled:boolean){const client=createSupabaseRouteClient();const {data,error}=await client.rpc("finance_set_operating_cash_account",{p_cash_account_id:cashAccountId,p_enabled:enabled});fail(error);return data;}

export async function receiveAmazonIncomeRpc(input: {
  forecastId: string; cashAccountId: string; receivedAmountEur: number;
  receivedAt: string; reference?: string | null; idempotencyKey: string;
}) {
  const client = createSupabaseRouteClient();
  const { data, error } = await client.rpc("finance_receive_amazon_income", {
    p_forecast_id: input.forecastId, p_cash_account_id: input.cashAccountId,
    p_received_amount_eur: input.receivedAmountEur, p_received_at: input.receivedAt,
    p_reference: input.reference ?? null, p_idempotency_key: input.idempotencyKey,
  });
  fail(error);
  return data as Record<string, unknown>;
}
