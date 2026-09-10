export type PlannerFundingInput={
  purchaseCapitalRequired:number;
  capitalAlreadyCommitted:number;
  operatingCashAvailableAboveReserveEur:number;
  totalCreditAvailableEur:number;
  amazonExpectedEur:number;
  newProductBudgetRate?:number;
};

export type PlannerFundingSummary={
  purchaseCapitalRequired:number;
  capitalAlreadyCommitted:number;
  operatingCashAvailableAboveReserveEur:number;
  totalCreditAvailableEur:number;
  amazonExpectedEur:number;
  immediateFundingCapacityEur:number;
  capacityIncludingExpectedAmazonEur:number;
  uncoveredImmediateNeedEur:number;
  surplusAfterCorePurchasesEur:number;
  suggestedNewProductBudgetEur:number;
  fundingStatus:"COVERED"|"CREDIT_REQUIRED"|"FUNDING_GAP";
};

const money=(value:number)=>Math.round((Math.max(0,value)+Number.EPSILON)*100)/100;

export function buildPlannerFundingSummary(input:PlannerFundingInput):PlannerFundingSummary{
  const purchase=money(input.purchaseCapitalRequired);
  const cash=money(input.operatingCashAvailableAboveReserveEur);
  const credit=money(input.totalCreditAvailableEur);
  const amazon=money(input.amazonExpectedEur);
  const immediate=money(cash+credit);
  const withAmazon=money(immediate+amazon);
  const gap=money(Math.max(0,purchase-immediate));
  const surplus=money(Math.max(0,immediate-purchase));
  const rate=Math.min(0.5,Math.max(0,input.newProductBudgetRate??0.1));
  return{
    purchaseCapitalRequired:purchase,
    capitalAlreadyCommitted:money(input.capitalAlreadyCommitted),
    operatingCashAvailableAboveReserveEur:cash,
    totalCreditAvailableEur:credit,
    amazonExpectedEur:amazon,
    immediateFundingCapacityEur:immediate,
    capacityIncludingExpectedAmazonEur:withAmazon,
    uncoveredImmediateNeedEur:gap,
    surplusAfterCorePurchasesEur:surplus,
    suggestedNewProductBudgetEur:money(surplus*rate),
    fundingStatus:purchase<=cash?"COVERED":purchase<=immediate?"CREDIT_REQUIRED":"FUNDING_GAP",
  };
}
