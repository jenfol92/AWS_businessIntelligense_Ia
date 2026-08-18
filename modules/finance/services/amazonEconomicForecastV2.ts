import { valueAmazonAmountEur, type EcbFxTable } from "./ecbFxService.ts";
import type { FinancesTransaction } from "@/modules/amazon-sp-api/financesClient";

export const AMAZON_ECONOMIC_FORECAST_V2_MODEL="amazon-economic-v2.1" as const;
export type ForecastConfidence="high"|"medium"|"low";
export type PriceSource="REALIZED_MTD"|"REALIZED_30D"|"CURRENT_LISTING"|"TARGET_FALLBACK";
export type FeeSource="PRODUCT_FEES_API"|"FBA_FEE_PREVIEW_REPORT"|"UNAVAILABLE";
export type StockFreshness="FRESH"|"STALE"|"UNAVAILABLE";
export type ForecastGap="ADS"|"AWD"|"AGL"|"FUTURE_REFUNDS"|"STORAGE"|"FEES"|"STOCK"|"FX";

export type AmazonRealMtdLine={
  identity:string;marketplaceId:string;marketplace:string;transactionType:string;postedDate:string;
  amountNative:number;currency:string;amountEur:number|null;fxSource:string;breakdownTypes:string[];
  economicClass:AmazonRealMtdEconomicClass;included:boolean;classificationReason:string;
};
export type AmazonRealMtdMarketplace={marketplace:string;currency:string;nativeAmount:number;amountEur:number|null;transactions:number;lines:AmazonRealMtdLine[]};
export type AmazonRealMtdEconomicClass="OPERATING_ECONOMIC_EVENT"|"AMAZON_INTERNAL_BALANCE_MOVEMENT"|"PAYOUT_CASH_TRANSFER"|"RESERVE_MOVEMENT"|"DEBT_RECOVERY"|"OTHER_NEEDS_REVIEW";
export type AmazonRealMtdClassification={included:boolean;economicClass:AmazonRealMtdEconomicClass;reason:string};

export const INCLUDE_REAL_MTD=["Shipment","Refund","ProductAdsPayment","ServiceFee","ServiceFee - Correction","ServiceFee - Reversal","FBAInventoryReimbursement","RemovalShipment","Retrocharge"] as const;
export const EXCLUDE_REAL_MTD=["Transfer","FundTransfer","Disbursement","FailedDisbursement","DisbursementCorrection","ReserveDebit","ReserveCredit","DebtRecovery"] as const;
export const NEEDS_SPECIAL_HANDLING=["Adjustment","MiscellaneousLedgerAdjustment"] as const;

function record(value:unknown):Record<string,any>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,any>:{};}
function money(value:unknown){const row=record(value);const amount=Number(row.currencyAmount??row.CurrencyAmount);const currency=String(row.currencyCode??row.CurrencyCode??"").toUpperCase();return {amount:Number.isFinite(amount)?amount:null,currency};}
function identifiers(transaction:Record<string,any>){return Array.isArray(transaction.relatedIdentifiers)?transaction.relatedIdentifiers:[];}
function identity(transaction:Record<string,any>){const preferred=["TRANSACTION_ID","DEFERRED_TRANSACTION_ID","REFUND_ID","SHIPMENT_ID","ORDER_ID","SETTLEMENT_ID"];for(const name of preferred){const value=identifiers(transaction).find((item:any)=>item.relatedIdentifierName===name)?.relatedIdentifierValue;if(value)return `${name}:${value}`;}return `${transaction.transactionType}:${transaction.postedDate}:${money(transaction.totalAmount).amount}`;}
function breakdownTypes(value:unknown,out=new Set<string>()){if(Array.isArray(value))for(const item of value)breakdownTypes(item,out);else if(value&&typeof value==="object"){const row=record(value);if(typeof row.breakdownType==="string")out.add(row.breakdownType);for(const child of Object.values(row))breakdownTypes(child,out);}return Array.from(out);}

export function classifyAmazonRealMtdTransaction(raw:FinancesTransaction):AmazonRealMtdClassification{
  const transaction=record(raw),transactionType=String(transaction.transactionType??"UNKNOWN"),types=new Set(breakdownTypes(transaction.breakdowns));
  if(transactionType==="Transfer"||transactionType==="FundTransfer"||transactionType==="Disbursement"||transactionType==="FailedDisbursement"||transactionType==="DisbursementCorrection"||Array.from(types).some(type=>type==="FundTransfer"||type==="FailedDisbursement"||type==="DisbursementCorrection"))return{included:false,economicClass:transactionType==="Transfer"||transactionType==="FundTransfer"||transactionType==="Disbursement"?"PAYOUT_CASH_TRANSFER":"AMAZON_INTERNAL_BALANCE_MOVEMENT",reason:"Movimiento de fondos/liquidación; no genera resultado económico"};
  if(transactionType==="ReserveDebit"||transactionType==="ReserveCredit"||types.has("ReserveDebit")||types.has("ReserveCredit"))return{included:false,economicClass:"RESERVE_MOVEMENT",reason:"Retención o liberación temporal de reserva Amazon"};
  if(transactionType==="DebtRecovery"||Array.from(types).some(type=>/DebtPayment|DebtRecovery/i.test(type)))return{included:false,economicClass:"DEBT_RECOVERY",reason:"Recuperación/liquidación de deuda; requiere reconciliar el evento económico originario"};
  if((INCLUDE_REAL_MTD as readonly string[]).includes(transactionType)||transactionType==="Adjustment"||transactionType==="MiscellaneousLedgerAdjustment")return{included:true,economicClass:"OPERATING_ECONOMIC_EVENT",reason:"Cargo, ingreso, devolución o ajuste operativo realizado"};
  return{included:false,economicClass:"OTHER_NEEDS_REVIEW",reason:"Tipo no reconocido: exclusión conservadora hasta clasificación explícita"};
}

export function buildAmazonRealMtd(params:{transactions:FinancesTransaction[];periodStart:string;periodEnd:string;ecb?:EcbFxTable|null}){
  const lines:AmazonRealMtdLine[]=[],excludedLines:AmazonRealMtdLine[]=[];
  for(const raw of params.transactions){const transaction=record(raw);const postedDate=String(transaction.postedDate??"");if(!postedDate||postedDate<params.periodStart||postedDate>params.periodEnd)continue;
    const total=money(transaction.totalAmount);if(total.amount==null||!total.currency)continue;
    const marketplaceDetails=record(transaction.marketplaceDetails);const marketplaceId=String(marketplaceDetails.marketplaceId??record(transaction.sellingPartnerMetadata).marketplaceId??"UNRESOLVED");const marketplace=String(marketplaceDetails.marketplaceName??marketplaceId);
    const classification=classifyAmazonRealMtdTransaction(raw),eur=valueAmazonAmountEur(total.currency,total.amount,undefined,params.ecb),line={identity:`actual:${marketplaceId}:${params.periodStart.slice(0,7)}:${identity(transaction)}`,marketplaceId,marketplace,transactionType:String(transaction.transactionType??"UNKNOWN"),postedDate,amountNative:total.amount,currency:total.currency,amountEur:eur.amountEur,fxSource:eur.fxSource,breakdownTypes:breakdownTypes(transaction.breakdowns),economicClass:classification.economicClass,included:classification.included,classificationReason:classification.reason};
    (classification.included?lines:excludedLines).push(line);
  }
  const grouped=new Map<string,AmazonRealMtdMarketplace>();for(const line of lines){const key=`${line.marketplaceId}|${line.currency}`;const current=grouped.get(key)??{marketplace:line.marketplace,currency:line.currency,nativeAmount:0,amountEur:0,transactions:0,lines:[]};current.nativeAmount+=line.amountNative;current.amountEur=current.amountEur==null||line.amountEur==null?null:current.amountEur+line.amountEur;current.transactions++;current.lines.push(line);grouped.set(key,current);}
  return {lines,excludedLines,marketplaces:Array.from(grouped.values()).map(row=>({...row,nativeAmount:round(row.nativeAmount),amountEur:row.amountEur==null?null:round(row.amountEur)}))};
}

export type FutureProductInput={
  productId:string;sku:string;asin:string|null;marketplace:string;marketplaceId:string;fulfillmentChannel:"FBA"|"FBM";
  currency:string;unitsMtd:number;rate7:number;rate14:number;rate30:number;remainingDays:number;
  weights:{days7:number;days14:number;days30:number};realizedPriceMtd?:number|null;realizedPrice30d?:number|null;listingPrice?:number|null;targetPrice?:number|null;
  stockValue?:number|null;stockFreshness:StockFreshness;stockObservedAt?:string|null;
  referralFeePerUnit?:number|null;fulfillmentFeePerUnit?:number|null;feeSource:FeeSource;feeObservedAt?:string|null;
  storageKnown?:number|null;ecb?:EcbFxTable|null;
};
export type AmazonFutureProductLine={
  sourceKey:string;productId:string;sku:string;asin:string|null;marketplace:string;marketplaceId:string;fulfillmentChannel:string;currency:string;
  unitsMtd:number;rate7:number;rate14:number;rate30:number;weightedRate:number;remainingDays:number;forecastUnits:number;
  stockValue:number|null;stockFreshness:StockFreshness;priceUsed:number;priceSource:PriceSource;
  referralFeePerUnit:number;fulfillmentFeePerUnit:number;feeSource:FeeSource;grossFuture:number;referralFuture:number;fulfillmentFuture:number;
  storageKnown:number;netFutureKnown:number;amountEur:number|null;fxSource:string;confidence:ForecastConfidence;gaps:ForecastGap[];sourceTimestamps:{stock:string|null;fees:string|null};
};
function round(value:number){return Math.round((value+Number.EPSILON)*100)/100;}
function nonNegative(value:number|null|undefined){const n=Number(value);return Number.isFinite(n)&&n>0?n:0;}
function selectPrice(input:FutureProductInput):{value:number;source:PriceSource}{if(nonNegative(input.realizedPriceMtd))return{value:nonNegative(input.realizedPriceMtd),source:"REALIZED_MTD"};if(nonNegative(input.realizedPrice30d))return{value:nonNegative(input.realizedPrice30d),source:"REALIZED_30D"};if(nonNegative(input.listingPrice))return{value:nonNegative(input.listingPrice),source:"CURRENT_LISTING"};return{value:nonNegative(input.targetPrice),source:"TARGET_FALLBACK"};}
export function buildAmazonFutureProductLine(input:FutureProductInput,meta:{asOfDate:string;periodStart:string;periodEnd:string;modelVersion?:string}):AmazonFutureProductLine{
  const weightTotal=input.weights.days7+input.weights.days14+input.weights.days30;if(weightTotal<=0)throw new Error("INVALID_FORECAST_RATE_WEIGHTS");
  const weightedRate=(input.rate7*input.weights.days7+input.rate14*input.weights.days14+input.rate30*input.weights.days30)/weightTotal;const unconstrained=Math.max(0,weightedRate*input.remainingDays);
  const forecastUnits=input.stockFreshness==="FRESH"&&input.stockValue!=null?Math.min(unconstrained,Math.max(0,input.stockValue)):unconstrained;
  const price=selectPrice(input),referral=nonNegative(input.referralFeePerUnit),fulfillment=input.fulfillmentChannel==="FBA"?nonNegative(input.fulfillmentFeePerUnit):0;
  const gross=forecastUnits*price.value,referralFuture=forecastUnits*referral,fulfillmentFuture=forecastUnits*fulfillment,storage=nonNegative(input.storageKnown),net=gross-referralFuture-fulfillmentFuture-storage;
  const valued=valueAmazonAmountEur(input.currency,net,undefined,input.ecb);const gaps:ForecastGap[]=["ADS","AWD","AGL","FUTURE_REFUNDS"];if(!storage)gaps.push("STORAGE");if(input.feeSource==="UNAVAILABLE")gaps.push("FEES");if(input.stockFreshness!=="FRESH")gaps.push("STOCK");if(valued.amountEur==null)gaps.push("FX");
  const confidence:ForecastConfidence=input.feeSource==="UNAVAILABLE"||input.stockFreshness!=="FRESH"||valued.amountEur==null?"low":price.source==="TARGET_FALLBACK"?"medium":"high";
  return {sourceKey:`forecast-v2:${input.marketplace}:${meta.asOfDate}:${meta.periodStart}:${meta.periodEnd}:${meta.modelVersion??AMAZON_ECONOMIC_FORECAST_V2_MODEL}`,productId:input.productId,sku:input.sku,asin:input.asin,marketplace:input.marketplace,marketplaceId:input.marketplaceId,fulfillmentChannel:input.fulfillmentChannel,currency:input.currency,unitsMtd:input.unitsMtd,rate7:input.rate7,rate14:input.rate14,rate30:input.rate30,weightedRate,remainingDays:input.remainingDays,forecastUnits,stockValue:input.stockValue??null,stockFreshness:input.stockFreshness,priceUsed:price.value,priceSource:price.source,referralFeePerUnit:referral,fulfillmentFeePerUnit:fulfillment,feeSource:input.feeSource,grossFuture:round(gross),referralFuture:round(referralFuture),fulfillmentFuture:round(fulfillmentFuture),storageKnown:round(storage),netFutureKnown:round(net),amountEur:valued.amountEur==null?null:round(valued.amountEur),fxSource:valued.fxSource,confidence,gaps:Array.from(new Set(gaps)),sourceTimestamps:{stock:input.stockObservedAt??null,fees:input.feeObservedAt??null}};
}

export function buildAmazonEconomicForecastV2(params:{asOfDate:string;periodStart:string;periodEnd:string;real:ReturnType<typeof buildAmazonRealMtd>;future:AmazonFutureProductLine[]}){
  const marketplaces=new Map<string,any>();for(const row of params.real.marketplaces){const key=row.marketplace;marketplaces.set(key,{marketplace:key,realNetMtdEur:row.amountEur??0,futureGrossEur:0,futureReferralEur:0,futureFbaFeesEur:0,futureStorageKnownEur:0,futureNetKnownEur:0,expectedMonthNetEur:row.amountEur??0,confidence:row.amountEur==null?"low":"high",gaps:new Set<ForecastGap>(),details:[]});}
  for(const line of params.future){const key=line.marketplace;const row=marketplaces.get(key)??{marketplace:key,realNetMtdEur:0,futureGrossEur:0,futureReferralEur:0,futureFbaFeesEur:0,futureStorageKnownEur:0,futureNetKnownEur:0,expectedMonthNetEur:0,confidence:"high",gaps:new Set<ForecastGap>(),details:[]};const rate=line.currency==="EUR"?1:line.netFutureKnown!==0&&line.amountEur!=null?line.amountEur/line.netFutureKnown:null;row.futureGrossEur+=rate==null?0:line.grossFuture*rate;row.futureReferralEur+=rate==null?0:line.referralFuture*rate;row.futureFbaFeesEur+=rate==null?0:line.fulfillmentFuture*rate;row.futureStorageKnownEur+=rate==null?0:line.storageKnown*rate;row.futureNetKnownEur+=line.amountEur??0;row.expectedMonthNetEur=row.realNetMtdEur+row.futureNetKnownEur;if(line.confidence==="low")row.confidence="low";else if(line.confidence==="medium"&&row.confidence==="high")row.confidence="medium";for(const gap of line.gaps)row.gaps.add(gap);row.details.push(line);marketplaces.set(key,row);}
  const rows=Array.from(marketplaces.values()).map(row=>({...row,futureGrossEur:round(row.futureGrossEur),futureReferralEur:round(row.futureReferralEur),futureFbaFeesEur:round(row.futureFbaFeesEur),futureStorageKnownEur:round(row.futureStorageKnownEur),futureNetKnownEur:round(row.futureNetKnownEur),expectedMonthNetEur:round(row.expectedMonthNetEur),gaps:Array.from(row.gaps)}));
  return {modelVersion:AMAZON_ECONOMIC_FORECAST_V2_MODEL,asOfDate:params.asOfDate,periodStart:params.periodStart,periodEnd:params.periodEnd,marketplaces:rows,europeTotalExpectedEur:round(rows.reduce((sum,row)=>sum+row.expectedMonthNetEur,0)),doesNotMutateTreasury:true};
}
