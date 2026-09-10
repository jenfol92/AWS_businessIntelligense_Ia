import { randomUUID } from "node:crypto";
import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import {supabaseAdmin} from "@/server/supabase/adminClient";
import {runWithSupabaseRouteClient} from "@/server/supabase/routeClient";
import {assertAmazonObservationSchemaReady,finishAmazonSync,readAmazonExpectedNetRatioAdmin,readRecentAmazonSalesAdmin,tryAcquireAmazonSync,upsertProjectedAmazonCycle} from "../repositories/amazonFinancialPlanningSyncRepository";
import type {AmazonFinancialPlanningSyncResult,AmazonProjectedCycle} from "../types/amazonFinancialPlanningSync.types";
import {projectRemainingMonth,roundMoney} from "./amazonTreasuryModel";
import {isTwinlyProduct} from "./amazonCashForecast";
import {observeAmazonTreasurySnapshots} from "./amazonTreasuryObservations";

const MARKETPLACES=["ES","FR","DE","IT","GB","PL","SE","NL","IE","BE"] as const;
function monthBounds(year:number,index:number){const start=new Date(Date.UTC(year,index,1));const end=new Date(Date.UTC(year,index+1,0));return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};}
function configuredMarketplaces(){return MARKETPLACES.filter(code=>String(process.env[`AMAZON_MARKETPLACE_${code}`]??"").trim());}

export async function buildProjectedAmazonCycles(now=new Date()):Promise<AmazonProjectedCycle[]>{
  const ratio=await readAmazonExpectedNetRatioAdmin();const year=now.getUTCFullYear();const horizon=6;const cycles:AmazonProjectedCycle[]=[];
  for(const marketplace of configuredMarketplaces()){
    const totals=Array.from({length:horizon},()=>({units:0,gross:0}));
    for(const channel of ["FBA","FBM"] as const){
      const analysis=await runWithSupabaseRouteClient(supabaseAdmin,()=>analyzeProducts({country:marketplace,channel:channel==="FBA"?"AMAZON_FBA":"AMAZON_FBM",scenario:"base",horizonMonths:horizon,windowDays:90}));
      const twinlyProducts=analysis.products.filter(product=>isTwinlyProduct(product));const recent=await readRecentAmazonSalesAdmin(twinlyProducts.map(p=>p.id),marketplace,channel,now);const forecasts=new Map(analysis.forecasts.map(f=>[f.productId,f]));
      for(const product of twinlyProducts){const forecast=forecasts.get(product.id);if(!forecast)continue;const price=Number(product.salePrice??0);if(price<=0)continue;for(let index=0;index<horizon;index++){const monthlyUnits=forecast.monthly[index]?.forecastUnits??0;if(index===0){const signal=recent.get(product.id)??{rate7:0,rate14:0,rate30:0,weekday:[]};const bounds=monthBounds(year,now.getUTCMonth());const projected=projectRemainingMonth({now,monthStart:bounds.start,monthEnd:bounds.end,monthlyUnits,rate7:signal.rate7,rate14:signal.rate14,rate30:signal.rate30,weekdayRates:signal.weekday,stockAvailable:Number(product.stockTotal??0),unitPrice:price});totals[index].units+=projected.forecastUnits;totals[index].gross+=projected.estimatedGrossEur;}else{totals[index].units+=monthlyUnits;totals[index].gross+=monthlyUnits*price;}}}
    }
    for(let index=0;index<horizon;index++){const gross=roundMoney(totals[index].gross);if(gross<=0)continue;const bounds=monthBounds(year,now.getUTCMonth()+index);cycles.push({marketplace,cycleStart:bounds.start,cycleEnd:bounds.end,forecastDate:bounds.end,forecastUnits:totals[index].units,estimatedGrossEur:gross,ratio,amazonExpectedEur:ratio==null?null:roundMoney(gross*ratio),sourceKey:`forecast:${marketplace}:${bounds.start}:${bounds.end}`,expectedBankDate:null,snapshotAt:now.toISOString(),confidence:"unavailable",estimationMethod:index===0?"twinly_planner_remaining_month_awaiting_release_and_net_history":"twinly_planner_future_month_awaiting_release_and_net_history"});}
  }
  return cycles;
}

export async function syncAmazonFinancialPlanning(options:{now?:Date;startedAfter?:string;startedBefore?:string;observationsOnly?:boolean;signal?:AbortSignal}={}):Promise<AmazonFinancialPlanningSyncResult>{
  await assertAmazonObservationSchemaReady(options.signal);
  const started=Date.now();const now=options.now??new Date();const runId=randomUUID();const lock=await (async()=>{console.info("[finance/amazon-sync] lock start");const value=await tryAcquireAmazonSync(runId,300,options.signal);console.info("[finance/amazon-sync] lock result",{acquired:value.acquired});return value;})();
  const result:AmazonFinancialPlanningSyncResult={successful:false,skipped:!lock.acquired,skipReason:lock.acquired?null:"already_running",projectedCreated:0,projectedUpdated:0,projected:[],settlementsFound:0,closed:0,open:0,matched:0,unmatched:0,ambiguous:0,confirmedAmountEur:0,availableUpserted:0,deferredUpserted:0,deferredReleasedObserved:0,pendingBankUpserted:0,settlementDiagnostics:[],errors:[],durationMs:0,lastSyncAt:now.toISOString()};
  if(!lock.acquired){result.durationMs=Date.now()-started;return result;}
  try{
    if(!options.observationsOnly){result.projected=await buildProjectedAmazonCycles(now);for(const cycle of result.projected){const outcome=await upsertProjectedAmazonCycle(cycle);if(outcome==="created")result.projectedCreated++;else if(outcome==="updated")result.projectedUpdated++;}}
    console.info("[finance/amazon-sync] observations start");
    const observations=await observeAmazonTreasurySnapshots({now,startedAfter:options.startedAfter,startedBefore:options.startedBefore,signal:options.signal});options.signal?.throwIfAborted();result.settlementsFound=observations.groups;result.availableUpserted=observations.available;result.pendingBankUpserted=observations.pendingBank;result.deferredUpserted=observations.deferred;result.unmatched=observations.unresolved;result.errors.push(...observations.errors);
    result.durationMs=Date.now()-started;result.lastSyncAt=new Date().toISOString();result.successful=result.errors.length===0;console.info("[finance/amazon-sync] saving result",{successful:result.successful,errorCount:result.errors.length});await finishAmazonSync(runId,result.successful,{...result,observations},result.successful?null:result.errors.map(error=>`${error.scope}:${error.message}`).join(" | "));return result;
  }catch(error){result.durationMs=Date.now()-started;result.errors.push({scope:"sync",message:error instanceof Error?error.message:String(error)});await finishAmazonSync(runId,false,result,result.errors.at(-1)?.message??"AMAZON_FINANCE_SYNC_FAILED");throw error;}
}
