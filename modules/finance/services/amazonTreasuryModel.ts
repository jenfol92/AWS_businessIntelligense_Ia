import type { AmazonEconomicState } from "../types/amazonFinancialPlanningSync.types";

export function roundMoney(value:number){return Math.round(value*100+1e-7)/100;}
export function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value));}

export function nextTransferRequestDate(from:Date,isoWeekdays:number[]):Date|null{
  if(isoWeekdays.length===0)return null;
  for(let offset=0;offset<14;offset++){const d=new Date(from);d.setUTCDate(d.getUTCDate()+offset);const iso=d.getUTCDay()===0?7:d.getUTCDay();if(isoWeekdays.includes(iso))return d;}
  return null;
}

export function addBusinessDays(from:Date,days:number){const d=new Date(from);let remaining=Math.max(0,Math.ceil(days));while(remaining>0){d.setUTCDate(d.getUTCDate()+1);const day=d.getUTCDay();if(day!==0&&day!==6)remaining--;}return d;}

export function expectedBankDateForAvailable(snapshotAt:Date,weekdays:number[],bankLagDays:number){const request=nextTransferRequestDate(snapshotAt,weekdays);return request?addBusinessDays(request,bankLagDays).toISOString().slice(0,10):null;}
export function expectedBankDateForPending(fundTransferAt:string|null,bankLagDays:number){return fundTransferAt?addBusinessDays(new Date(fundTransferAt),bankLagDays).toISOString().slice(0,10):null;}

export function stateContributesFuture(state:AmazonEconomicState,amountEur:number|null,expectedBankDate:string|null,hasValidDeferredEstimate=true){
  if(amountEur==null||amountEur<=0||!expectedBankDate)return false;
  if(state==="RECEIVED")return false;
  if(state==="DEFERRED"&&!hasValidDeferredEstimate)return false;
  return state!=="FUTURE"||expectedBankDate!=null;
}

export type FutureProjectionInput={now:Date;monthStart:string;monthEnd:string;monthlyUnits:number;rate7:number;rate14:number;rate30:number;weekdayRates?:number[];stockAvailable:number;unitPrice:number};
export function projectRemainingMonth(input:FutureProjectionInput){
  const start=new Date(`${input.monthStart}T00:00:00Z`),end=new Date(`${input.monthEnd}T00:00:00Z`);
  const daysInMonth=end.getUTCDate();const plannerDaily=input.monthlyUnits/Math.max(1,daysInMonth);
  const recent=.5*input.rate7+.3*input.rate14+.2*input.rate30;
  const trend=plannerDaily>0?clamp(recent/plannerDaily,.5,1.5):0;
  const weekday=input.weekdayRates??[];const positive=weekday.filter(v=>v>0);const weekdayMean=positive.length>=7?positive.reduce((s,v)=>s+v,0)/7:0;
  let remainingStock=Math.max(0,input.stockAvailable),units=0;const daily:Array<{date:string;units:number}> = [];
  const cursor=new Date(Math.max(start.getTime(),Date.UTC(input.now.getUTCFullYear(),input.now.getUTCMonth(),input.now.getUTCDate()+1)));
  while(cursor<=end&&remainingStock>0){const weekdayFactor=weekdayMean>0?clamp((weekday[cursor.getUTCDay()]??weekdayMean)/weekdayMean,.5,1.5):1;const dayUnits=Math.min(remainingStock,plannerDaily*trend*weekdayFactor);if(dayUnits>0){daily.push({date:cursor.toISOString().slice(0,10),units:dayUnits});units+=dayUnits;remainingStock-=dayUnits;}cursor.setUTCDate(cursor.getUTCDate()+1);}
  const gross=roundMoney(units*input.unitPrice);return{daily,forecastUnits:units,estimatedGrossEur:gross,amazonExpectedEur:gross,ratio:null,trendMultiplier:trend};
}
