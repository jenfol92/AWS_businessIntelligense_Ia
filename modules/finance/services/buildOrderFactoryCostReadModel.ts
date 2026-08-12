import type {FactoryCostLineInput,FactoryCostObligationInput,FactoryCostTrace,OrderFactoryCostReadModel} from "../types/orderFactoryCostReadModel.types";

const round=(value:number,decimals=4)=>Math.round(value*10**decimals)/10**decimals;

export function buildOrderFactoryCostReadModel(input:{orderId:string;lines:FactoryCostLineInput[];obligations:FactoryCostObligationInput[]}):OrderFactoryCostReadModel{
  const orderOriginal=input.lines.reduce((sum,line)=>sum+line.quantity*line.unitOriginal,0);
  if (!Number.isFinite(orderOriginal)||orderOriginal<=0) throw new Error("INVALID_ORDER_ORIGINAL_TOTAL");
  let realPaid=0,estimatedPending=0,estimatedPlan=0;let fxPending=false,planFxMissing=false;let originalPendingTotal=0;
  const tracesByLine=new Map<string,FactoryCostTrace[]>();
  for(const line of input.lines) tracesByLine.set(line.id,[]);
  for(const obligation of input.obligations){
    const allocatedOriginal=obligation.allocations.reduce((sum,row)=>sum+row.amountOriginal,0);
    const pendingOriginal=Math.max(0,obligation.amountOriginal-allocatedOriginal);
    originalPendingTotal+=pendingOriginal;
    realPaid+=obligation.allocations.reduce((sum,row)=>sum+row.amountEur,0);
    const fx=obligation.currency.toUpperCase()==="EUR"?1:obligation.plannedFxForeignPerEur;
    if(!fx||fx<=0) planFxMissing=true; else estimatedPlan+=obligation.amountOriginal/fx;
    if(pendingOriginal>0.0001&&(!fx||fx<=0)) fxPending=true;
    else if(pendingOriginal>0.0001) estimatedPending+=pendingOriginal/(fx as number);
    for(const allocation of obligation.allocations){
      for(const line of input.lines){
        const share=(line.quantity*line.unitOriginal)/orderOriginal;
        tracesByLine.get(line.id)!.push({orderId:input.orderId,lineId:line.id,obligationId:obligation.id,batchId:allocation.batchId,allocationId:allocation.id,allocatedEur:round(allocation.amountEur*share)});
      }
    }
  }
  const estimatedTotal=planFxMissing?null:estimatedPlan;
  const provisionalTotal=fxPending?null:realPaid+estimatedPending;
  const fullyPaid=originalPendingTotal<=0.0001;
  const realTotal=fullyPaid?realPaid:null;
  return {orderId:input.orderId,estimatedFactoryCostEur:estimatedTotal,provisionalFactoryCostEur:provisionalTotal,realFactoryCostEur:realTotal,fxPending,lines:input.lines.map(line=>{
    const share=(line.quantity*line.unitOriginal)/orderOriginal;const quantity=line.quantity;
    const estimated=estimatedTotal==null?null:round(estimatedTotal*share);const provisional=provisionalTotal==null?null:round(provisionalTotal*share);const real=realTotal==null?null:round(realTotal*share);
    return {lineId:line.id,estimatedFactoryCostEur:estimated,provisionalFactoryCostEur:provisional,realFactoryCostEur:real,estimatedUnitFactoryCostEur:estimated==null?null:round(estimated/quantity),provisionalUnitFactoryCostEur:provisional==null?null:round(provisional/quantity),realUnitFactoryCostEur:real==null?null:round(real/quantity),trace:tracesByLine.get(line.id)!};
  })};
}
