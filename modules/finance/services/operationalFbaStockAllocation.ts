import type { AmazonOperationalFbaStockRow } from "../repositories/amazonEconomicForecastV2Repository";

const PAN_EU_MARKETPLACES=new Set(["ES","FR","DE","IT","PL","SE","NL","BE","IE"]);

export function resolveStockFreshness(observedAt:string|null|undefined,now:Date,maxAgeHours=48):"FRESH"|"STALE"|"UNAVAILABLE"{
  if(!observedAt)return"UNAVAILABLE";
  const observedMs=Date.parse(observedAt);
  if(!Number.isFinite(observedMs))return"UNAVAILABLE";
  return now.getTime()-observedMs<=maxAgeHours*3600000?"FRESH":"STALE";
}

export type StockAllocationInput={productId:string;marketplace:string;fulfillmentChannel:"FBA"|"FBM";demandUnits:number};

export function allocateOperationalFbaStock(rows:StockAllocationInput[],stocks:Map<string,AmazonOperationalFbaStockRow>,now:Date,maxAgeHours=48){
  const pool=(row:StockAllocationInput)=>row.marketplace==="GB"?"UK":PAN_EU_MARKETPLACES.has(row.marketplace)?"EU":"UNSUPPORTED";
  const totals=new Map<string,number>();
  const peers=new Map<string,number>();
  for(const row of rows){
    if(row.fulfillmentChannel!=="FBA")continue;
    const key=`${row.productId}|${pool(row)}`;
    totals.set(key,(totals.get(key)??0)+Math.max(0,row.demandUnits));
    peers.set(key,(peers.get(key)??0)+1);
  }
  return rows.map(row=>{
    const stock=stocks.get(row.productId),operationalPool=pool(row);
    if(row.fulfillmentChannel!=="FBA"||!stock||operationalPool==="UNSUPPORTED")return{stockValue:null,stockFreshness:"UNAVAILABLE" as const,stockObservedAt:stock?.observed_at??null,operationalPool};
    const poolStock=operationalPool==="UK"?stock.stock_fba_uk:stock.stock_fba_pan_eu;
    const key=`${row.productId}|${operationalPool}`;
    const totalDemand=totals.get(key)??0;
    const share=totalDemand>0?Math.max(0,row.demandUnits)/totalDemand:1/Math.max(1,peers.get(key)??1);
    return{stockValue:Math.max(0,poolStock)*share,stockFreshness:stock.dual_pool_complete?resolveStockFreshness(stock.observed_at,now,maxAgeHours):"UNAVAILABLE" as const,stockObservedAt:stock.observed_at||null,operationalPool};
  });
}
