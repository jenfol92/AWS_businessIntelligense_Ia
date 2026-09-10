import { getAmazonSyncState } from "../repositories/amazonFinancialPlanningSyncRepository";
import { syncAmazonFinancialPlanning } from "./amazonFinancialPlanningSync";

export const AMAZON_FINANCE_FRESHNESS_MS=30*60*1000;

/** Screen reads never start a sync. Explicit refresh/cron own that operation. */
export async function readAmazonPlanningFreshness(now = new Date()): Promise<AmazonPlanningFreshness> {
  try {
    const state = await getAmazonSyncState();
    const age = state.lastSuccessfulAt ? now.getTime() - new Date(state.lastSuccessfulAt).getTime() : Infinity;
    const stale = state.status !== "succeeded" || age < 0 || age >= AMAZON_FINANCE_FRESHNESS_MS;
    return { stale, warning: stale ? "AMAZON_FINANCE_SYNC_STALE" : null,
      lastSuccessfulAmazonSyncAt: state.lastSuccessfulAt, syncAttempted: false };
  } catch {
    return { stale: true, warning: "AMAZON_FINANCE_SYNC_STALE", lastSuccessfulAmazonSyncAt: null, syncAttempted: false };
  }
}

export type AmazonPlanningFreshness = {
  stale: boolean;
  warning: "AMAZON_FINANCE_SYNC_STALE" | null;
  lastSuccessfulAmazonSyncAt: string | null;
  syncAttempted: boolean;
};

export async function ensureFreshAmazonFinancialPlanning(
  now=new Date(),
  deps={getState:getAmazonSyncState,sync:syncAmazonFinancialPlanning},
):Promise<AmazonPlanningFreshness>{
  let state;
  try{state=await deps.getState();}catch{return {stale:true,warning:"AMAZON_FINANCE_SYNC_STALE",lastSuccessfulAmazonSyncAt:null,syncAttempted:false};}
  const age=state.lastSuccessfulAt?now.getTime()-new Date(state.lastSuccessfulAt).getTime():Number.POSITIVE_INFINITY;
  if(state.status==="succeeded"&&age>=0&&age<AMAZON_FINANCE_FRESHNESS_MS)return {stale:false,warning:null,lastSuccessfulAmazonSyncAt:state.lastSuccessfulAt,syncAttempted:false};
  if(state.status==="running"&&state.lockedUntil&&new Date(state.lockedUntil)>now)return {stale:true,warning:"AMAZON_FINANCE_SYNC_STALE",lastSuccessfulAmazonSyncAt:state.lastSuccessfulAt,syncAttempted:false};
  try{const result=await deps.sync({now});if(result.skipped||!result.successful)return {stale:true,warning:"AMAZON_FINANCE_SYNC_STALE",lastSuccessfulAmazonSyncAt:state.lastSuccessfulAt,syncAttempted:true};return {stale:false,warning:null,lastSuccessfulAmazonSyncAt:result.lastSyncAt,syncAttempted:true};}
  catch{return {stale:true,warning:"AMAZON_FINANCE_SYNC_STALE",lastSuccessfulAmazonSyncAt:state.lastSuccessfulAt,syncAttempted:true};}
}
