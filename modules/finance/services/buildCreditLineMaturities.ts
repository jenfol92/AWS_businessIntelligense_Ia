import { findOpenCreditLineMaturities } from "../repositories/creditLineMaturitiesRepository";
import type {
  CreditLineLegacyGap,
  CreditLineMaturitiesQuery,
  CreditLineMaturitiesResponse,
  CreditLineMaturity,
  CreditLineMaturityFilter,
  CreditLineMaturitySummary,
  CreditLineMaturityVisualStatus,
} from "../types/creditLineMaturities.types";
import {
  creditLineDrawdownAllowed,
  isDeletedCreditLineStatus,
} from "@/modules/finance/utils/creditLineStatus";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400000);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthEnd(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function mapDisplayStatus(
  groupStatus: string,
  dueDate: string,
  asOf: string,
): CreditLineMaturity["displayStatus"] {
  const overdue = dueDate < asOf;
  if (groupStatus === "partially_paid") {
    return overdue ? "vencido_parcial" : "parcial";
  }
  return overdue ? "vencido" : "pendiente";
}

function mapVisualStatus(
  groupStatus: string,
  dueDate: string,
  asOf: string,
): CreditLineMaturityVisualStatus {
  if (groupStatus === "partially_paid" && dueDate >= asOf) return "partial";
  if (dueDate < asOf) return "overdue";
  if (dueDate === asOf) return "due_today";
  const days = daysBetween(asOf, dueDate);
  if (days <= 7) return "next_7";
  if (days <= 15) return "next_15";
  if (groupStatus === "partially_paid") return "partial";
  return "pending";
}

function matchesFilter(
  maturity: CreditLineMaturity,
  filter: CreditLineMaturityFilter | undefined,
  asOf: string,
): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "overdue") return maturity.dueDate < asOf;
  if (filter === "next_7") {
    return maturity.dueDate >= asOf && maturity.dueDate <= addDaysIso(asOf, 7);
  }
  if (filter === "next_15") {
    return maturity.dueDate >= asOf && maturity.dueDate <= addDaysIso(asOf, 15);
  }
  if (filter === "this_month") {
    return maturity.dueDate >= monthStart(asOf) && maturity.dueDate <= monthEnd(asOf);
  }
  if (filter === "partial") {
    return maturity.groupStatus === "partially_paid";
  }
  return true;
}

function buildSummary(maturities: CreditLineMaturity[], asOf: string): CreditLineMaturitySummary {
  const next7 = addDaysIso(asOf, 7);
  const next15 = addDaysIso(asOf, 15);
  const monthFrom = monthStart(asOf);
  const monthTo = monthEnd(asOf);

  const summary: CreditLineMaturitySummary = {
    overdueAmountEur: 0,
    next7AmountEur: 0,
    next15AmountEur: 0,
    thisMonthAmountEur: 0,
    totalPendingAmountEur: 0,
    overdueCount: 0,
    next7Count: 0,
    next15Count: 0,
    thisMonthCount: 0,
    totalCount: maturities.length,
  };

  for (const item of maturities) {
    summary.totalPendingAmountEur += item.remainingAmountEur;
    if (item.dueDate < asOf) {
      summary.overdueAmountEur += item.remainingAmountEur;
      summary.overdueCount += 1;
    }
    if (item.dueDate >= asOf && item.dueDate <= next7) {
      summary.next7AmountEur += item.remainingAmountEur;
      summary.next7Count += 1;
    }
    if (item.dueDate >= asOf && item.dueDate <= next15) {
      summary.next15AmountEur += item.remainingAmountEur;
      summary.next15Count += 1;
    }
    if (item.dueDate >= monthFrom && item.dueDate <= monthTo) {
      summary.thisMonthAmountEur += item.remainingAmountEur;
      summary.thisMonthCount += 1;
    }
  }

  return summary;
}

export async function buildCreditLineMaturities(
  query: CreditLineMaturitiesQuery = {},
  canManageCreditLineRegularizations = false,
  canExecuteCreditLineRepayments = false,
): Promise<CreditLineMaturitiesResponse> {
  const asOf = todayIso();
  const { groups, legacyGaps } = await findOpenCreditLineMaturities(query);

  const allMaturities: CreditLineMaturity[] = groups
    .filter((group) => !isDeletedCreditLineStatus(group.line_status))
    .filter((group) => group.status === "open" || group.status === "partially_paid")
    .map((group) => {
      const groupStatus = group.status as "open" | "partially_paid";
      const lineAllowsDrawdown = creditLineDrawdownAllowed(group.line_status);
      return {
        id: group.id,
        creditLineId: group.credit_line_id,
        repaymentGroupId: group.id,
        bankName: group.bank_name,
        lineName: group.line_name,
        creditLimit: group.credit_limit,
        lineStatus: group.line_status,
        lineAllowsDrawdown,
        dueDate: group.due_date,
        originalAmountEur: group.amount,
        paidAmountEur: group.paid_amount,
        remainingAmountEur: group.remaining_amount,
        groupStatus,
        displayStatus: mapDisplayStatus(groupStatus, group.due_date, asOf),
        visualStatus: mapVisualStatus(groupStatus, group.due_date, asOf),
        daysUntilDue: daysBetween(asOf, group.due_date),
        movementCount: group.movement_count,
        financedOrderCount: group.financed_order_codes.length,
        financedOrderCodes: group.financed_order_codes,
        canRepay: group.remaining_amount > 0,
        isLegacyOpeningBalance: group.is_legacy_opening_balance,
        expectedInterestEur: group.expected_interest_eur,
        expectedFeesEur: group.expected_fees_eur,
      };
    });

  const filtered = allMaturities.filter((item) => matchesFilter(item, query.status, asOf));

  const legacy: CreditLineLegacyGap[] = legacyGaps.map((gap) => ({
    creditLineId: gap.id,
    bankName: gap.bank_name,
    lineName: gap.line_name,
    creditLimit: gap.credit_limit,
    usedAmount: gap.used_amount,
    explainedRemaining: gap.explained_remaining,
    unexplainedAmount: Math.max(0, gap.used_amount - gap.explained_remaining),
    repaymentMode: gap.repayment_mode,
    cycleDays: gap.cycle_days,
  }));

  return {
    ok: true,
    asOf,
    summary: buildSummary(
      allMaturities.filter((item) => matchesFilter(item, undefined, asOf)),
      asOf,
    ),
    maturities: filtered,
    legacyGaps: legacy,
    permissions: { canManageCreditLineRegularizations, canExecuteCreditLineRepayments },
  };
}
