export type TreasuryEvent = {
  id: string; date: string; title: string; kind: "income" | "outflow" | "maturity";
  amountEur: number; refinancedAmountEur?: number;
  amazonEconomicState?: "FUTURE"|"DEFERRED"|"AVAILABLE"|"PENDING_BANK"|"RECEIVED"|"LEGACY_CONFIRMED";
  confidence?: string|null;
};
export type TreasuryLine = { id:string; name:string; availableEur:number; priority:number|null; dueDate:string|null; cycleDays:number|null; knownCostEur?:number|null };
export type TreasuryStatus = "healthy"|"watch"|"stress"|"high_stress"|"critical";
export type TreasuryEvaluation = {
  status:TreasuryStatus; firstProblemDate:string|null; minimumCashDate:string|null; minimumCashEur:number;
  reserveEur:number; usableCreditEur:number; deficitEur:number; causingEvents:Array<{id:string;title:string;date:string;amountEur:number}>;
  nextIncome:{date:string;amountEur:number}|null; refinancedAmountEur:number; recommendation:string; expectedResult:string;
};

export function simulateAvailableLiquidity(input:{cashEur:number;availableEur:number;requiredEur:number}){
  const requestedEur=Math.min(Math.max(0,input.availableEur),Math.max(0,input.requiredEur));
  return {cashEur:input.cashEur,requestedEur,residualNeedEur:Math.max(0,input.requiredEur-requestedEur)};
}

export function evaluateTreasury(input:{initialCashEur:number;reserveEur:number;events:TreasuryEvent[];lines:TreasuryLine[]}):TreasuryEvaluation {
  const events=input.events.filter(event=>event.kind!=="income"||!event.amazonEconomicState||!["RECEIVED","LEGACY_CONFIRMED","AVAILABLE"].includes(event.amazonEconomicState)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const activeLines=input.lines.filter(line=>line.availableEur>0);
  const usableCreditEur=activeLines.reduce((sum,line)=>sum+line.availableEur,0);
  let cash=input.initialCashEur; let minimumCashEur=cash; let minimumCashDate:string|null=null; let firstProblemDate:string|null=cash<input.reserveEur?events[0]?.date??null:null;
  let refinancedAmountEur=0; const causingEvents:TreasuryEvaluation["causingEvents"]=[];
  for(const event of events){ cash += event.kind==="income"?event.amountEur:-event.amountEur; refinancedAmountEur+=event.refinancedAmountEur??0;
    if(cash<minimumCashEur){minimumCashEur=cash;minimumCashDate=event.date;} if(cash<input.reserveEur&&!firstProblemDate)firstProblemDate=event.date;
    if(cash<input.reserveEur&&event.kind!=="income")causingEvents.push({id:event.id,title:event.title,date:event.date,amountEur:event.amountEur});
  }
  const deficitEur=Math.max(0,-(minimumCashEur+usableCreditEur));
  const nextIncome=events.find(event=>event.kind==="income"&&(!firstProblemDate||event.date>=firstProblemDate));
  const concentration=events.filter(event=>event.kind==="maturity"&&event.date===minimumCashDate).reduce((s,e)=>s+e.amountEur,0);
  let status:TreasuryStatus;
  if(minimumCashEur>=input.reserveEur)status="healthy";
  else if(minimumCashEur>=0)status="watch";
  else if(deficitEur>0)status="critical";
  else if(refinancedAmountEur>0||concentration>usableCreditEur-input.reserveEur)status="high_stress";
  else status="stress";
  const amountToCover=Math.max(0,input.reserveEur-minimumCashEur);
  const eligible=activeLines.filter(line=>!nextIncome||!line.dueDate||line.dueDate>=nextIncome.date).sort((a,b)=>(a.priority??999)-(b.priority??999)||(b.dueDate??"9999-12-31").localeCompare(a.dueDate??"9999-12-31"));
  const line=eligible.find(candidate=>candidate.availableEur>=amountToCover);
  let recommendation="Mantener la reserva; no se requiere financiación.";
  let expectedResult=`Caja mínima esperada: ${minimumCashEur.toFixed(2)} EUR.`;
  if(status!=="healthy"){
    if(line){recommendation=`Usar ${line.name} por ${amountToCover.toFixed(2)} EUR; prioridad ${line.priority??"no informada"}; coste ${line.knownCostEur==null?"no informado":`${line.knownCostEur.toFixed(2)} EUR`}.${line.cycleDays==null?" Requiere fecha manual de vencimiento.":""}`;expectedResult=`Caja mínima tras cobertura: ${(minimumCashEur+amountToCover).toFixed(2)} EUR; reserva ${input.reserveEur.toFixed(2)} EUR.`;}
    else {recommendation=`Cobertura insuficiente: déficit exacto ${deficitEur.toFixed(2)} EUR.`;expectedResult=`Déficit restante: ${deficitEur.toFixed(2)} EUR.`;}
  }
  return {status,firstProblemDate,minimumCashDate,minimumCashEur,reserveEur:input.reserveEur,usableCreditEur,deficitEur,causingEvents:causingEvents.slice(-5),nextIncome:nextIncome?{date:nextIncome.date,amountEur:nextIncome.amountEur}:null,refinancedAmountEur,recommendation,expectedResult};
}
