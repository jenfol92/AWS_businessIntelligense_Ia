import { assertAmazonObservationSchemaError } from "../utils/amazonObservationSchema";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import type { AmazonProjectedCycle, AmazonSyncState } from "../types/amazonFinancialPlanningSync.types";
import type { AmazonSettlementCandidate, AmazonSettlementReconciliation } from "../types/amazonSettlement.types";

function fail(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function getAmazonSyncState(): Promise<AmazonSyncState> {
  const { data,error }=await supabaseAdmin.from("finance_amazon_sync_state").select("status,locked_until,last_successful_at,last_result").eq("sync_key","amazon_financial_planning").single();
  fail(error);
  return {status:data.status,lastSuccessfulAt:data.last_successful_at,lockedUntil:data.locked_until,lastResult:data.last_result};
}

export async function tryAcquireAmazonSync(runId:string,leaseSeconds=300,signal?:AbortSignal) {
  const {data,error}=await supabaseAdmin.rpc("finance_try_acquire_amazon_sync",{p_run_id:runId,p_lease_seconds:leaseSeconds}).abortSignal(signal??AbortSignal.timeout(15_000));fail(error);return data as {acquired:boolean;lastSuccessfulAt:string|null};
}

export async function finishAmazonSync(runId:string,succeeded:boolean,result:unknown,errorMessage:string|null) {
  const {data,error}=await supabaseAdmin.rpc("finance_finish_amazon_sync",{p_run_id:runId,p_succeeded:succeeded,p_result:result,p_error:errorMessage}).abortSignal(AbortSignal.timeout(15_000));fail(error);return data;
}

export async function upsertProjectedAmazonCycle(cycle:AmazonProjectedCycle):Promise<"created"|"updated"|"locked"> {
  const before=await supabaseAdmin.from("finance_amazon_income_forecasts").select("id,status").eq("source_key",cycle.sourceKey).maybeSingle();fail(before.error);
  if (before.data && !["projected","accumulated","previsto"].includes(String(before.data.status).toLowerCase())) return "locked";
  const {error}=await supabaseAdmin.rpc("finance_upsert_amazon_income",{
    p_source_key:cycle.sourceKey,p_forecast_date:cycle.forecastDate,p_description:`Amazon previsto ${cycle.marketplace} ${cycle.cycleStart.slice(0,7)}`,
    p_amount_eur:cycle.amazonExpectedEur,p_status:"projected",p_marketplace:cycle.marketplace,p_cycle_start:cycle.cycleStart,p_cycle_end:cycle.cycleEnd,
    p_estimated_gross_eur:cycle.estimatedGrossEur,p_historical_net_ratio:cycle.ratio,p_confirmed_amount_eur:null,
    p_notes:"Fuente: forecast canonico del planner; precio_venta_objetivo por producto.",
  });fail(error);
  const update=await supabaseAdmin.from("finance_amazon_income_forecasts").update({economic_state:"FUTURE",expected_availability_date:null,expected_request_date:null,expected_bank_date:cycle.expectedBankDate,date_is_estimated:true,confidence:cycle.confidence,estimation_method:cycle.estimationMethod,treasury_amount_eur:cycle.amazonExpectedEur,original_currency:"EUR",original_amount:cycle.estimatedGrossEur,snapshot_at:cycle.snapshotAt}).eq("source_key",cycle.sourceKey).select("id").single();fail(update.error);
  const snapshot=await supabaseAdmin.from("finance_amazon_treasury_forecast_snapshots").insert({forecast_id:update.data.id,source_key:cycle.sourceKey,marketplace:cycle.marketplace,economic_state:"FUTURE",snapshot_at:cycle.snapshotAt,expected_availability_date:null,expected_request_date:null,expected_bank_date:cycle.expectedBankDate,original_currency:"EUR",original_amount:cycle.estimatedGrossEur,official_amount_eur:null,estimated_amount_eur:cycle.amazonExpectedEur,confidence:cycle.confidence,estimation_method:cycle.estimationMethod});fail(snapshot.error);
  return before.data?"updated":"created";
}

export async function reconcileAmazonSettlementAdmin(settlement:AmazonSettlementCandidate):Promise<AmazonSettlementReconciliation> {
  const {data,error}=await supabaseAdmin.rpc("finance_reconcile_amazon_settlement",{
    p_settlement_id:settlement.settlementId,p_marketplace:settlement.marketplace,p_currency:settlement.currency,p_amount:settlement.amount,
    p_cycle_start:settlement.cycleStart?.slice(0,10)??null,p_cycle_end:settlement.cycleEnd?.slice(0,10)??null,p_fund_transfer_at:settlement.fundTransferAt,
    p_fund_transfer_status:settlement.transferStatus,p_trace_id:settlement.traceId,p_processing_status:settlement.processingStatus,
    p_source_payload:{group:settlement.group,transactions:settlement.transactions},
  });fail(error);return data as AmazonSettlementReconciliation;
}

export async function readAmazonExpectedNetRatioAdmin():Promise<number|null>{const {data,error}=await supabaseAdmin.from("finance_settings").select("value").eq("key","amazon_expected_net_ratio").maybeSingle();fail(error);if(data?.value==null||String(data.value).trim()==="")return null;const ratio=Number(data.value);if(!Number.isFinite(ratio)||ratio<0||ratio>1)throw new Error("INVALID_AMAZON_EXPECTED_NET_RATIO");return ratio;}

export type AmazonTreasuryItem = {
  sourceKey:string; economicState:"AVAILABLE"|"DEFERRED"|"PENDING_BANK"; marketplace:string;
  originalCurrency:string; originalAmount:number; amountEur:number|null;
  amazonTransactionId?:string|null; transactionStatus?:"DEFERRED"|"DEFERRED_RELEASED"|"RELEASED"|null;
  snapshotAt:string; availabilityDate?:string|null; expectedBankDate?:string|null;
  expectedAvailabilityDate?:string|null; expectedRequestDate?:string|null;
  dateIsEstimated:boolean; confidence:"exact"|"high"|"medium"|"low"|"unavailable";
  estimationMethod:string; officialConvertedAmountEur?:number|null; settlementId?:string|null;
  fundTransferStatus?:string|null; fundTransferAt?:string|null;
};

export async function upsertAmazonTreasuryItemAdmin(item:AmazonTreasuryItem){
  const {data,error}=await supabaseAdmin.rpc("finance_upsert_amazon_treasury_item",{
    p_source_key:item.sourceKey,p_economic_state:item.economicState,p_marketplace:item.marketplace,
    p_original_currency:item.originalCurrency,p_original_amount:item.originalAmount,p_amount_eur:item.amountEur,
    p_amazon_transaction_id:item.amazonTransactionId??null,p_transaction_status:item.transactionStatus??null,
    p_snapshot_at:item.snapshotAt,p_availability_date:item.availabilityDate??null,p_expected_bank_date:item.expectedBankDate??null,
    p_date_is_estimated:item.dateIsEstimated,p_confidence:item.confidence,p_estimation_method:item.estimationMethod,
    p_official_converted_amount_eur:item.officialConvertedAmountEur??null,p_settlement_id:item.settlementId??null,
    p_fund_transfer_status:item.fundTransferStatus??null,p_fund_transfer_at:item.fundTransferAt??null,
  });fail(error);
  const row=data as {id?:string}|null;
  if(row?.id){
    const dates=await supabaseAdmin.from("finance_amazon_income_forecasts").update({expected_availability_date:item.expectedAvailabilityDate??null,expected_request_date:item.expectedRequestDate??null}).eq("id",row.id);fail(dates.error);
    const snapshot=await supabaseAdmin.from("finance_amazon_treasury_forecast_snapshots").insert({forecast_id:row.id,source_key:item.sourceKey,marketplace:item.marketplace,economic_state:item.economicState,snapshot_at:item.snapshotAt,expected_availability_date:item.expectedAvailabilityDate??null,expected_request_date:item.expectedRequestDate??null,expected_bank_date:item.expectedBankDate??null,original_currency:item.originalCurrency,original_amount:item.originalAmount,official_amount_eur:item.officialConvertedAmountEur??null,estimated_amount_eur:item.officialConvertedAmountEur==null?item.amountEur:null,confidence:item.confidence,estimation_method:item.estimationMethod});fail(snapshot.error);
  }
  return data;
}

export type AmazonTreasuryObservation = {
  observationKey:string; sourceKey:string; marketplace:string;
  economicState:"AVAILABLE"|"DEFERRED"|"PENDING_BANK"; observedAt:string;
  originalCurrency:string; originalAmount:number; amountEur:number|null;
  officialAmountEur:number|null; financialEventGroupId?:string|null;
  amazonTransactionId?:string|null; transactionStatus?:string|null;
  settlementProcessingStatus?:string|null; fundTransferStatus?:string|null;
  fundTransferAt?:string|null; expectedAvailabilityDate?:string|null;
  expectedRequestDate?:string|null; expectedBankDate?:string|null;
  confidence:string; estimationMethod:string; fxSource:string;
  fxObservedAt?:string|null; fxKind:"AMAZON_REALIZED_FX"|"ERP_ESTIMATED_FX"|"UNAVAILABLE";
  estimatedFxRate?:number|null; realizedFxRate?:number|null; realizedAmountEur?:number|null;
  source:string; evidence:Record<string,unknown>;
};

export async function insertAmazonTreasuryObservationAdmin(item:AmazonTreasuryObservation,signal?:AbortSignal){
  const {data,error}=await supabaseAdmin.rpc("finance_insert_amazon_treasury_observation",{
    p_observation_key:item.observationKey,p_source_key:item.sourceKey,p_marketplace:item.marketplace,
    p_economic_state:item.economicState,p_observed_at:item.observedAt,
    p_original_currency:item.originalCurrency,p_original_amount:item.originalAmount,
    p_amount_eur:item.amountEur,p_official_amount_eur:item.officialAmountEur,
    p_financial_event_group_id:item.financialEventGroupId??null,
    p_amazon_transaction_id:item.amazonTransactionId??null,p_transaction_status:item.transactionStatus??null,
    p_settlement_processing_status:item.settlementProcessingStatus??null,
    p_fund_transfer_status:item.fundTransferStatus??null,p_fund_transfer_at:item.fundTransferAt??null,
    p_expected_availability_date:item.expectedAvailabilityDate??null,
    p_expected_request_date:item.expectedRequestDate??null,p_expected_bank_date:item.expectedBankDate??null,
    p_confidence:item.confidence,p_estimation_method:item.estimationMethod,
    p_fx_source:item.fxSource,p_fx_observed_at:item.fxObservedAt??null,p_fx_kind:item.fxKind,
    p_estimated_fx_rate:item.estimatedFxRate??null,p_realized_fx_rate:item.realizedFxRate??null,p_realized_amount_eur:item.realizedAmountEur??null,
    p_source:item.source,p_evidence:item.evidence,
  }).abortSignal(signal??AbortSignal.timeout(15_000));assertAmazonObservationSchemaError(error);return data;
}

export async function observeAmazonDeferredReleaseAdmin(transactionId:string,observedAt:string){
  const {data,error}=await supabaseAdmin.rpc("finance_observe_amazon_deferred_release",{p_amazon_transaction_id:transactionId,p_observed_at:observedAt});fail(error);return data;
}

export async function retireStaleAmazonTreasuryStatesAdmin(states:Array<"AVAILABLE"|"DEFERRED"|"PENDING_BANK">,snapshotAt:string){
  if(states.length===0)return;
  const {error}=await supabaseAdmin.from("finance_amazon_income_forecasts").update({economic_state:null,treasury_amount_eur:null,expected_bank_date:null,updated_at:new Date().toISOString()}).in("economic_state",states).lt("snapshot_at",snapshotAt);fail(error);
}

export async function readAmazonTreasurySettingsAdmin(signal?:AbortSignal){
  const keys=["amazon_transfer_request_weekdays","amazon_bank_lag_days","amazon_treasury_percentile","amazon_min_history_samples"];
  const {data,error}=await supabaseAdmin.from("finance_settings").select("key,value").in("key",keys).abortSignal(signal??AbortSignal.timeout(15_000));fail(error);
  const values=new Map((data??[]).map(row=>[String(row.key),row.value]));
  const rawWeekdays=values.get("amazon_transfer_request_weekdays");
  let weekdays=[1,3];try{const parsed=typeof rawWeekdays==="string"?JSON.parse(rawWeekdays):rawWeekdays;if(Array.isArray(parsed)&&parsed.every(v=>Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=7))weekdays=parsed.map(Number);}catch{}
  return {weekdays,bankLagDays:Math.max(0,Number(values.get("amazon_bank_lag_days")??2)),percentile:Number(values.get("amazon_treasury_percentile")??.75),minHistorySamples:Math.max(1,Number(values.get("amazon_min_history_samples")??100))};
}

export async function readRecentAmazonSalesAdmin(productIds:string[],marketplace:string,channel:"FBA"|"FBM",now:Date){
  if(productIds.length===0)return new Map<string,{rate7:number;rate14:number;rate30:number;weekday:number[]}>();
  const from=new Date(now);from.setUTCDate(from.getUTCDate()-84);
  const {data,error}=await supabaseAdmin.from("ventas_diarias").select("producto_id,fecha,unidades_vendidas,canal_venta,pais")
    .in("producto_id",productIds).eq("pais",marketplace).eq("canal_venta",channel).gte("fecha",from.toISOString().slice(0,10));fail(error);
  const out=new Map<string,{rate7:number;rate14:number;rate30:number;weekday:number[]}>();
  for(const id of productIds){const rows=(data??[]).filter(row=>row.producto_id===id);const sum=(days:number)=>rows.filter(row=>(now.getTime()-new Date(`${row.fecha}T00:00:00Z`).getTime())/86400000<days).reduce((s,row)=>s+Number(row.unidades_vendidas??0),0)/days;
    const weekday=Array(7).fill(0),counts=Array(7).fill(0);for(const row of rows){const d=new Date(`${row.fecha}T00:00:00Z`).getUTCDay();weekday[d]+=Number(row.unidades_vendidas??0);counts[d]++;}for(let i=0;i<7;i++)weekday[i]=counts[i]?weekday[i]/counts[i]:0;
    out.set(id,{rate7:sum(7),rate14:sum(14),rate30:sum(30),weekday});}
  return out;
}

export async function assertAmazonObservationSchemaReady(signal?:AbortSignal) {
  const {error}=await supabaseAdmin.from("finance_amazon_treasury_forecast_snapshots")
    .select("fx_kind,estimated_fx_rate,realized_amount_eur,realized_fx_rate").limit(0)
    .abortSignal(signal??AbortSignal.timeout(15_000));
  assertAmazonObservationSchemaError(error);
}
