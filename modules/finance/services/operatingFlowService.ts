import { refinanceCreditLineRpc, recordOperatingTreasuryRpc, receiveAmazonIncomeRpc, setOperatingCashAccountRpc, upsertAmazonIncome } from "../repositories/operatingFlowRepository";
import { getAmazonExpectedNetRatio } from "../repositories/amazonSettlementRepository";
import type { AmazonIncomeInput, CreditLineRefinancingInput, CreditLineRefinancingResult, OperatingTreasuryInput } from "../types/operatingFlow.types";

function money(value: unknown, field: string, allowZero = false): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0) || Math.round(number * 100) !== number * 100) {
    throw new Error(`INVALID_AMOUNT: ${field}`);
  }
  return number;
}
function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`REQUIRED: ${field}`);
  return value.trim();
}

export async function refinanceCreditLine(input: CreditLineRefinancingInput): Promise<CreditLineRefinancingResult> {
  required(input.sourceRepaymentGroupId,"sourceRepaymentGroupId"); required(input.fundingCreditLineId,"fundingCreditLineId");
  required(input.effectiveDate,"effectiveDate"); required(input.idempotencyKey,"idempotencyKey");
  const row = await refinanceCreditLineRpc({...input,principalEur:money(input.principalEur,"principalEur"),interestEur:money(input.interestEur,"interestEur",true),feesEur:money(input.feesEur,"feesEur",true)});
  return {refinancingId:String(row.refinancing_id),sourceCreditLineId:String(row.source_credit_line_id),fundingCreditLineId:String(row.funding_credit_line_id),fundingRepaymentGroupId:String(row.funding_repayment_group_id),principalEur:Number(row.principal_eur),interestEur:Number(row.interest_eur),feesEur:Number(row.fees_eur),fundedTotalEur:Number(row.funded_total_eur),fundingDueDate:String(row.funding_due_date),sourceCreditUsedEur:Number(row.source_credit_used_eur),fundingCreditUsedEur:Number(row.funding_credit_used_eur),idempotent:Boolean(row.idempotent)};
}

export async function recordOperatingTreasury(input: OperatingTreasuryInput) {
  required(input.cashAccountId,"cashAccountId"); required(input.effectiveDate,"effectiveDate"); required(input.idempotencyKey,"idempotencyKey");
  return recordOperatingTreasuryRpc({...input,amountEur:money(input.amountEur,"amountEur")});
}

export async function saveAmazonIncome(input: AmazonIncomeInput) {
  required(input.sourceKey,"sourceKey"); required(input.forecastDate,"forecastDate"); required(input.description,"description");
  if (input.status !== "projected") throw new Error("FORECAST_MUST_BE_PROJECTED");
  const estimatedGrossEur=money(input.estimatedGrossEur ?? input.amountEur,"estimatedGrossEur");
  const historicalNetRatio=await getAmazonExpectedNetRatio();
  return upsertAmazonIncome({...input,estimatedGrossEur,historicalNetRatio,amountEur:Math.round(estimatedGrossEur*historicalNetRatio*100)/100,status:"projected"});
}

export async function receiveAmazonIncome(input: Parameters<typeof receiveAmazonIncomeRpc>[0]) {
  required(input.forecastId,"forecastId"); required(input.cashAccountId,"cashAccountId"); required(input.receivedAt,"receivedAt"); required(input.idempotencyKey,"idempotencyKey");
  if (!input.idempotencyKey.startsWith("amazon-receive:")) throw new Error("INVALID_RECEIPT_IDEMPOTENCY_KEY");
  return receiveAmazonIncomeRpc({...input,receivedAmountEur:money(input.receivedAmountEur,"receivedAmountEur")});
}
export async function setOperatingCashAccount(cashAccountId:string,enabled:boolean){required(cashAccountId,"cashAccountId");return setOperatingCashAccountRpc(cashAccountId,enabled);}
