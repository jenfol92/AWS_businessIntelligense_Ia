export type FactoryCostLineInput={id:string;quantity:number;unitOriginal:number};
export type FactoryCostAllocationInput={id:string;obligationId:string;batchId:string;amountOriginal:number;amountEur:number};
export type FactoryCostObligationInput={id:string;amountOriginal:number;currency:string;plannedFxForeignPerEur:number|null;allocations:FactoryCostAllocationInput[]};
export type FactoryCostTrace={orderId:string;lineId:string;obligationId:string;batchId:string;allocationId:string;allocatedEur:number};
export type FactoryCostLineResult={lineId:string;estimatedFactoryCostEur:number|null;provisionalFactoryCostEur:number|null;realFactoryCostEur:number|null;estimatedUnitFactoryCostEur:number|null;provisionalUnitFactoryCostEur:number|null;realUnitFactoryCostEur:number|null;trace:FactoryCostTrace[]};
export type OrderFactoryCostReadModel={orderId:string;estimatedFactoryCostEur:number|null;provisionalFactoryCostEur:number|null;realFactoryCostEur:number|null;fxPending:boolean;lines:FactoryCostLineResult[]};
