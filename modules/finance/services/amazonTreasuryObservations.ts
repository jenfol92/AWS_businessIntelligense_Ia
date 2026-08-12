import { createHash } from "node:crypto";
import { listFinancialEventGroups,listTransactions,type FinancesTransaction,type FinancialEventGroup } from "@/modules/amazon-sp-api/financesClient";
import { insertAmazonTreasuryObservationAdmin,readAmazonTreasurySettingsAdmin,type AmazonTreasuryObservation } from "../repositories/amazonFinancialPlanningSyncRepository";
import { addBusinessDays,expectedBankDateForPending,nextTransferRequestDate } from "./amazonTreasuryModel";

const IDS:Record<string,string>={A1RKKUPIHCS9HS:"ES",A13V1IB3VIYZZH:"FR",A1PA6795UKMFR9:"DE",APJ6JRA9NG5V4:"IT",A1F83G8C2ARO7P:"GB",A1C3SOZRARQ6R3:"PL",A2NODRKZP88ZB9:"SE",A1805IZSGTT6HS:"NL",A28R8C7NBKEWEA:"IE",AMEN7PMS3EDWL:"BE"};
const NAMES:Record<string,string>={"amazon.es":"ES","amazon.fr":"FR","amazon.de":"DE","amazon.it":"IT","amazon.co.uk":"GB","amazon.pl":"PL","amazon.se":"SE","amazon.nl":"NL","amazon.ie":"IE","amazon.com.be":"BE"};

function signals(value:unknown,out=new Set<string>()):Set<string>{
  if(typeof value==="string"){const code=IDS[value]??NAMES[value.trim().toLowerCase()];if(code)out.add(code);}
  else if(Array.isArray(value))for(const item of value)signals(item,out);
  else if(value&&typeof value==="object")for(const item of Object.values(value as Record<string,unknown>))signals(item,out);
  return out;
}
export function resolveObservationMarketplace(transactions:FinancesTransaction[]):string{
  const found=Array.from(signals(transactions));return found.length===1?found[0]:"UNRESOLVED";
}
function transactionFields(transaction:FinancesTransaction){const t=transaction as Record<string,unknown>;const money=(t.totalAmount??{}) as Record<string,unknown>;return {id:typeof t.transactionId==="string"?t.transactionId:null,currency:typeof money.currencyCode==="string"?money.currencyCode.toUpperCase():null,amount:Number(money.currencyAmount)};}
export function materialKey(state:string,identity:string,observedAt:string,material:unknown){
  const bucket=observedAt.slice(0,10);const hash=createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0,16);
  return `amazon-observation:v1:${state}:${identity}:${bucket}:${hash}`;
}
function eurAmounts(currency:string,amount:number,converted?:{CurrencyCode?:string;CurrencyAmount?:number}){
  if(currency==="EUR")return {amountEur:amount,officialAmountEur:amount,fxSource:"identity_eur"};
  if(converted?.CurrencyCode?.toUpperCase()==="EUR"&&Number.isFinite(Number(converted.CurrencyAmount)))return {amountEur:Number(converted.CurrencyAmount),officialAmountEur:Number(converted.CurrencyAmount),fxSource:"amazon_official_converted_total"};
  return {amountEur:null,officialAmountEur:null,fxSource:"unavailable"};
}
function schedule(now:Date,weekdays:number[],lag:number){const request=nextTransferRequestDate(now,weekdays);return {available:now.toISOString().slice(0,10),request:request?.toISOString().slice(0,10)??null,bank:request?addBusinessDays(request,lag).toISOString().slice(0,10):null};}
export function groupObservation(group:FinancialEventGroup,transactions:FinancesTransaction[],now:Date,weekdays:number[],lag:number):AmazonTreasuryObservation|null{
  const pending=group.ProcessingStatus==="Closed"&&group.FundTransferStatus==="Processing";if(group.ProcessingStatus!=="Open"&&!pending)return null;
  const currency=group.OriginalTotal?.CurrencyCode?.toUpperCase();const amount=Number(group.OriginalTotal?.CurrencyAmount);if(!currency||!Number.isFinite(amount))return null;
  const state=pending?"PENDING_BANK":"AVAILABLE";const marketplace=resolveObservationMarketplace(transactions);const dates=schedule(now,weekdays,lag);const fx=eurAmounts(currency,amount,group.ConvertedTotal);
  const expectedBankDate=pending?expectedBankDateForPending(group.FundTransferDate??null,lag):dates.bank;
  const material={amount,currency,marketplace,processingStatus:group.ProcessingStatus,fundTransferStatus:group.FundTransferStatus??null,fundTransferAt:group.FundTransferDate??null,expectedBankDate};
  return {observationKey:materialKey(state,group.FinancialEventGroupId,now.toISOString(),material),sourceKey:`${pending?"pending-bank":"available"}:${group.FinancialEventGroupId}`,marketplace,economicState:state,observedAt:now.toISOString(),originalCurrency:currency,originalAmount:amount,...fx,financialEventGroupId:group.FinancialEventGroupId,settlementProcessingStatus:group.ProcessingStatus,fundTransferStatus:group.FundTransferStatus??null,fundTransferAt:group.FundTransferDate??null,expectedAvailabilityDate:pending?group.FundTransferDate?.slice(0,10)??null:dates.available,expectedRequestDate:pending?null:dates.request,expectedBankDate,confidence:pending&&group.FundTransferDate?"high":marketplace==="UNRESOLVED"?"low":"medium",estimationMethod:pending?"amazon_fund_transfer_date_plus_configured_bank_lag":"open_original_total_next_configured_transfer_window",fxObservedAt:fx.fxSource==="unavailable"?null:now.toISOString(),source:"amazon_sp_api_finances",evidence:{financialEventGroupId:group.FinancialEventGroupId,processingStatus:group.ProcessingStatus,fundTransferStatus:group.FundTransferStatus??null,fundTransferAt:group.FundTransferDate??null,marketplaceSignals:Array.from(signals(transactions)).sort(),transactionCount:transactions.length}};
}

export type AmazonObservationRunResult={observedAt:string;groups:number;available:number;pendingBank:number;deferred:number;unresolved:number;written:number;errors:Array<{scope:string;message:string}>};
async function withQuotaRetry<T>(operation:()=>Promise<T>):Promise<T>{for(let attempt=0;;attempt++){try{return await operation();}catch(error){const message=error instanceof Error?error.message:String(error);if(attempt>=2||!message.toLowerCase().includes("quota"))throw error;await new Promise(resolve=>setTimeout(resolve,(attempt+1)*5000));}}}
export async function observeAmazonTreasurySnapshots(options:{now?:Date;startedAfter?:string;startedBefore?:string}={},deps={groups:listFinancialEventGroups,transactions:listTransactions,settings:readAmazonTreasurySettingsAdmin,insert:insertAmazonTreasuryObservationAdmin}):Promise<AmazonObservationRunResult>{
  const now=options.now??new Date();const historyStart=new Date(now);historyStart.setUTCDate(historyStart.getUTCDate()-179);const before=options.startedBefore??new Date(Math.min(now.getTime()-180000,Date.now()-180000)).toISOString();const settings=await deps.settings();const result:AmazonObservationRunResult={observedAt:now.toISOString(),groups:0,available:0,pendingBank:0,deferred:0,unresolved:0,written:0,errors:[]};
  const groups=await withQuotaRetry(()=>deps.groups({startedAfter:options.startedAfter??historyStart.toISOString(),startedBefore:before}));result.groups=groups.length;
  for(const group of groups){if(group.ProcessingStatus!=="Open"&&!(group.ProcessingStatus==="Closed"&&group.FundTransferStatus==="Processing"))continue;try{let tx:FinancesTransaction[];try{tx=await withQuotaRetry(()=>deps.transactions({financialEventGroupId:group.FinancialEventGroupId,postedAfter:group.FinancialEventGroupStart,postedBefore:group.FinancialEventGroupEnd}));}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.toLowerCase().includes("before 2 years"))throw error;tx=await withQuotaRetry(()=>deps.transactions({financialEventGroupId:group.FinancialEventGroupId}));}const item=groupObservation(group,tx,now,settings.weekdays,settings.bankLagDays);if(!item)continue;await deps.insert(item);result.written++;if(item.marketplace==="UNRESOLVED")result.unresolved++;if(item.economicState==="AVAILABLE")result.available++;else result.pendingBank++;}catch(error){result.errors.push({scope:group.FinancialEventGroupId,message:error instanceof Error?error.message:String(error)});}}
  const deferred=await withQuotaRetry(()=>deps.transactions({transactionStatus:"DEFERRED",postedAfter:historyStart.toISOString(),postedBefore:before}));
  for(const transaction of deferred){try{const value=transactionFields(transaction);if(!value.id||!value.currency||!Number.isFinite(value.amount)){result.errors.push({scope:"deferred",message:"INVALID_DEFERRED_TRANSACTION"});continue;}const marketplace=resolveObservationMarketplace([transaction]);const fx=eurAmounts(value.currency,value.amount);const material={amount:value.amount,currency:value.currency,marketplace,transactionStatus:"DEFERRED"};const item:AmazonTreasuryObservation={observationKey:materialKey("DEFERRED",value.id,now.toISOString(),material),sourceKey:`amazon-transaction:${value.id}`,marketplace,economicState:"DEFERRED",observedAt:now.toISOString(),originalCurrency:value.currency,originalAmount:value.amount,...fx,amazonTransactionId:value.id,transactionStatus:"DEFERRED",expectedAvailabilityDate:null,expectedRequestDate:null,expectedBankDate:null,confidence:"unavailable",estimationMethod:"observed_deferred_transaction_awaiting_release_evidence",fxObservedAt:fx.fxSource==="unavailable"?null:now.toISOString(),source:"amazon_sp_api_finances",evidence:{amazonTransactionId:value.id,transactionStatus:"DEFERRED",marketplaceSignals:Array.from(signals(transaction)).sort()}};await deps.insert(item);result.written++;result.deferred++;if(marketplace==="UNRESOLVED")result.unresolved++;}catch(error){result.errors.push({scope:"deferred",message:error instanceof Error?error.message:String(error)});}}
  return result;
}
