import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_MONEY_EXCLUSIVE = 1_000_000_000_000;

export type PlannedMaturityStatus = "planned" | "paid" | "cancelled";
export type CreditLinePlannedMaturity = {
  id: string; creditLineId: string; bankName: string; lineName: string; dueDate: string;
  plannedPrincipalEur: number; expectedInterestEur: number; expectedFeesEur: number;
  plannedCashOutEur: number; concept: string; reference: string | null; notes: string | null;
  status: PlannedMaturityStatus; linkedRepaymentGroupId: string | null; linkedRepaymentId: string | null;
};
export type PlannedMaturityInput = {
  creditLineId: string; dueDate: string; plannedPrincipalEur: number;
  expectedInterestEur: number; expectedFeesEur: number; concept: string;
  reference: string | null; notes: string | null; idempotencyKey: string;
};
export type PlannedMaturityPatchInput = Omit<PlannedMaturityInput,"creditLineId"|"idempotencyKey">;
export type PlannedMaturityRepositoryClient = SupabaseClient;
