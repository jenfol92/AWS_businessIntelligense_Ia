import { AmazonObservationSchemaError } from "../utils/amazonObservationSchema";
import { forEachBounded } from "../utils/forEachBounded";
import { setTimeout as delay } from "node:timers/promises";
import { listFinancialEventGroups,listTransactions,type FinancesTransaction,type FinancialEventGroup } from "@/modules/amazon-sp-api/financesClient";
import { insertAmazonTreasuryObservationAdmin,readAmazonTreasurySettingsAdmin,type AmazonTreasuryObservation } from "../repositories/amazonFinancialPlanningSyncRepository";
import { getLatestEcbFxTable,type EcbFxTable } from "./ecbFxService";
import { buildDeferredTreasuryObservation } from "./amazonTreasuryDeferredFields";
import { groupObservation } from "./amazonTreasuryGroupObservation";

export { buildDeferredTreasuryObservation } from "./amazonTreasuryDeferredFields";
export {
  DEFERRED_RELATED_IDENTIFIER_NAMES,
  extractDeferredContext,
  extractUsefulRelatedIdentifiers,
  parseAmazonPostedAt,
  parseAmazonReleaseDate,
} from "./amazonTreasuryDeferredFields";
export { resolveObservationMarketplace } from "./amazonTreasuryObservationCore";
export { groupObservation } from "./amazonTreasuryGroupObservation";

export type AmazonObservationRunResult={runId:string;observedAt:string;groups:number;available:number;pendingBank:number;deferred:number;unresolved:number;written:number;errors:Array<{scope:string;message:string}>};
async function withQuotaRetry<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{for(let attempt=0;;attempt++){signal?.throwIfAborted();try{return await operation();}catch(error){signal?.throwIfAborted();const message=error instanceof Error?error.message:String(error);if(attempt>=2||!message.toLowerCase().includes("quota"))throw error;await delay((attempt+1)*5000,undefined,{signal});}}}
export async function observeAmazonTreasurySnapshots(options:{runId:string;now?:Date;startedAfter?:string;startedBefore?:string;signal?:AbortSignal},deps={groups:listFinancialEventGroups,transactions:listTransactions,settings:readAmazonTreasurySettingsAdmin,insert:insertAmazonTreasuryObservationAdmin,fx:getLatestEcbFxTable}):Promise<AmazonObservationRunResult>{
  if(!options.runId)throw new Error("AMAZON_SYNC_RUN_REQUIRED");
  const now=options.now??new Date();const historyStart=new Date(now);historyStart.setUTCDate(historyStart.getUTCDate()-179);const before=options.startedBefore??new Date(Math.min(now.getTime()-180000,Date.now()-180000)).toISOString();console.info("[finance/amazon-observations] settings start");const settings=await deps.settings(options.signal);console.info("[finance/amazon-observations] settings done");const result:AmazonObservationRunResult={runId:options.runId,observedAt:now.toISOString(),groups:0,available:0,pendingBank:0,deferred:0,unresolved:0,written:0,errors:[]};
  let ecb:EcbFxTable|null=null;try{console.info("[finance/amazon-observations] ECB start");ecb=await deps.fx({now,signal:options.signal});console.info("[finance/amazon-observations] ECB done");}catch(error){if(error instanceof AmazonObservationSchemaError)throw error;result.errors.push({scope:"ecb_fx",message:error instanceof Error?error.message:String(error)});}console.info("[finance/amazon-observations] financial groups start");const groups=await withQuotaRetry(()=>deps.groups({signal:options.signal,startedAfter:options.startedAfter??historyStart.toISOString(),startedBefore:before}),options.signal);result.groups=groups.length;console.info("[finance/amazon-observations] financial groups done",{count:groups.length});
  for(const group of groups){options.signal?.throwIfAborted();if(group.ProcessingStatus!=="Open"&&!(group.ProcessingStatus==="Closed"&&group.FundTransferStatus==="Processing"))continue;try{console.info("[finance/amazon-observations] group transactions start");let tx:FinancesTransaction[];try{tx=await withQuotaRetry(()=>deps.transactions({signal:options.signal,financialEventGroupId:group.FinancialEventGroupId,postedAfter:group.FinancialEventGroupStart,postedBefore:group.FinancialEventGroupEnd}),options.signal);}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.toLowerCase().includes("before 2 years"))throw error;tx=await withQuotaRetry(()=>deps.transactions({signal:options.signal,financialEventGroupId:group.FinancialEventGroupId}),options.signal);}console.info("[finance/amazon-observations] group transactions done",{count:tx.length});const item=groupObservation(group,tx,now,settings.weekdays,ecb);if(!item)continue;await deps.insert({...item,syncRunId:options.runId},options.signal);result.written++;if(item.marketplace==="UNRESOLVED")result.unresolved++;if(item.economicState==="AVAILABLE")result.available++;else result.pendingBank++;}catch(error){if(error instanceof AmazonObservationSchemaError)throw error;result.errors.push({scope:group.FinancialEventGroupId,message:error instanceof Error?error.message:String(error)});}}
  console.info("[finance/amazon-observations] deferred transactions start");
  const deferred=await withQuotaRetry(()=>deps.transactions({signal:options.signal,transactionStatus:"DEFERRED",postedAfter:historyStart.toISOString(),postedBefore:before}),options.signal);
  console.info("[finance/amazon-observations] deferred transactions done",{count:deferred.length});
  console.info("[finance/amazon-observations] deferred persistence start",{total:deferred.length,concurrency:8});
  await forEachBounded(deferred,8,async (transaction)=>{options.signal?.throwIfAborted();try{const item=buildDeferredTreasuryObservation(transaction,now,ecb);if(!item){result.errors.push({scope:"deferred",message:"INVALID_DEFERRED_TRANSACTION"});return;}await deps.insert({...item,syncRunId:options.runId},options.signal);result.written++;result.deferred++;if(result.deferred%100===0)console.info("[finance/amazon-observations] deferred saved",{saved:result.deferred,total:deferred.length});if(item.marketplace==="UNRESOLVED")result.unresolved++;}catch(error){if(error instanceof AmazonObservationSchemaError)throw error;result.errors.push({scope:"deferred",message:error instanceof Error?error.message:String(error)});}},options.signal);
  console.info("[finance/amazon-observations] deferred persistence done",{saved:result.deferred,total:deferred.length,errorCount:result.errors.length});
  options.signal?.throwIfAborted();
  return result;
}
