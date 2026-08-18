import type { AmazonEconomicState } from "../types/amazonFinancialPlanningSync.types";
import { addBusinessDays, nextTransferRequestDate, payoutArrivalWindow, roundMoney } from "./amazonTreasuryModel.ts";

export type AmazonTreasuryScenario = "conservative" | "base" | "optimistic";

export type TwinlySalesObservation = {
  date: string;
  marketplace: string;
  productId: string;
  sku: string | null;
  asin: string | null;
  brand: string | null;
  units: number;
  revenueEur: number | null;
};

export type TwinlyShare = {
  marketplace: string;
  windowDays: 7 | 30 | 60 | 90;
  twinlyUnits: number;
  totalUnits: number;
  unitShare: number | null;
  twinlyRevenueEur: number;
  totalRevenueEur: number;
  revenueShare: number | null;
};

export type AmazonReleaseObservation = {
  transactionId: string;
  marketplace: string;
  deferredPostedAt: string;
  releasedPostedAt: string;
};

export type AmazonLagStats = {
  marketplace: string;
  samples: number;
  p50Days: number | null;
  p75Days: number | null;
  p90Days: number | null;
};

export type AmazonCashItem = {
  identity: string;
  marketplace: string;
  state: AmazonEconomicState;
  originalCurrency: string;
  originalAmount: number;
  officialAmountEur: number | null;
  estimatedAmountEur: number | null;
  expectedBankDate: string | null;
  expectedRequestDate?: string | null;
  actualRequestDate?: string | null;
  confidence: "exact" | "high" | "medium" | "low" | "unavailable";
  estimationMethod: string;
  snapshotAt?: string | null;
  fxSource?: string | null;
  fxRate?: number | null;
  fxObservedAt?: string | null;
  scenarioAmountsEur?: Partial<Record<AmazonTreasuryScenario, number>>;
};

export type AmazonMarketplaceCashCard = {
  marketplace: string;
  currency: string;
  availableOriginal: number;
  availableEur: number | null;
  availablePositiveEur: number | null;
  deferredOriginal: number;
  deferredEur: number | null;
  pendingBankOriginal: number;
  pendingBankEur: number | null;
  futureEur: number;
  totalEconomicEur: number;
  expectedBankDate: string | null;
  availableExpectedRequestDate: string | null;
  availableArrivalBase: string | null;
  availableArrivalConservative: string | null;
  availableTiming: "ESTIMATED_CONDITIONAL" | null;
  pendingBankArrivalBase: string | null;
  pendingBankArrivalConservative: string | null;
  confidence: string;
  estimationMethod: string;
  lastSnapshotAt: string | null;
  fxSources: string[];
  fxRate: number | null;
  fxObservedAt: string | null;
  containsEstimatedFx: boolean;
};

const PRECEDENCE: Record<AmazonEconomicState, number> = {
  RECEIVED: 5,
  PENDING_BANK: 4,
  AVAILABLE: 3,
  DEFERRED: 2,
  FUTURE: 1,
};

export function isTwinlyProduct(product: { brand?: string | null; sku?: string | null; asin?: string | null }) {
  return String(product.brand ?? "").trim().toLocaleLowerCase("en") === "twinly"
    && Boolean(String(product.sku ?? "").trim() || String(product.asin ?? "").trim());
}

export function calculateTwinlyShares(rows: TwinlySalesObservation[], now: Date): TwinlyShare[] {
  const marketplaces = Array.from(new Set(rows.map(row => row.marketplace))).concat("EUROPE");
  return marketplaces.flatMap(marketplace => ([7, 30, 60, 90] as const).map(windowDays => {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - windowDays + 1);
    const selected = rows.filter(row => (marketplace === "EUROPE" || row.marketplace === marketplace)
      && new Date(`${row.date}T00:00:00Z`) >= start && new Date(`${row.date}T00:00:00Z`) <= now);
    const twinly = selected.filter(isTwinlyProduct);
    const totalUnits = selected.reduce((sum, row) => sum + Math.max(0, row.units), 0);
    const twinlyUnits = twinly.reduce((sum, row) => sum + Math.max(0, row.units), 0);
    const totalRevenueEur = selected.reduce((sum, row) => sum + Math.max(0, row.revenueEur ?? 0), 0);
    const twinlyRevenueEur = twinly.reduce((sum, row) => sum + Math.max(0, row.revenueEur ?? 0), 0);
    return {
      marketplace,
      windowDays,
      twinlyUnits,
      totalUnits,
      unitShare: totalUnits > 0 ? twinlyUnits / totalUnits : null,
      twinlyRevenueEur: roundMoney(twinlyRevenueEur),
      totalRevenueEur: roundMoney(totalRevenueEur),
      revenueShare: totalRevenueEur > 0 ? twinlyRevenueEur / totalRevenueEur : null,
    };
  }));
}

function percentile(values: number[], probability: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(probability * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}

export function calculateReleaseLagStats(observations: AmazonReleaseObservation[]): AmazonLagStats[] {
  const grouped = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const observation of observations) {
    const identity = `${observation.marketplace}:${observation.transactionId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const start = new Date(observation.deferredPostedAt);
    const end = new Date(observation.releasedPostedAt);
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    if (!Number.isFinite(days) || days < 0) continue;
    const values = grouped.get(observation.marketplace) ?? [];
    values.push(days);
    grouped.set(observation.marketplace, values);
  }
  return Array.from(grouped.entries()).map(([marketplace, values]) => ({
    marketplace,
    samples: values.length,
    p50Days: percentile(values, 0.5),
    p75Days: percentile(values, 0.75),
    p90Days: percentile(values, 0.9),
  }));
}

export function estimateEur(input: {
  originalAmount: number;
  originalCurrency: string;
  officialAmountEur?: number | null;
  estimatedForeignPerEur?: number | null;
}) {
  if (input.officialAmountEur != null) return { amountEur: input.officialAmountEur, kind: "official" as const };
  if (input.originalCurrency === "EUR") return { amountEur: input.originalAmount, kind: "official" as const };
  if (input.estimatedForeignPerEur != null && input.estimatedForeignPerEur > 0) {
    return { amountEur: roundMoney(input.originalAmount / input.estimatedForeignPerEur), kind: "estimated" as const };
  }
  return { amountEur: null, kind: "unvalued" as const };
}

export function cashDateFromSale(input: {
  expectedSaleDate: string;
  releaseLagDays: number | null;
  requestWeekdays: number[];
  bankLagDays: number;
}) {
  if (input.releaseLagDays == null) return null;
  const availability = new Date(`${input.expectedSaleDate}T00:00:00Z`);
  availability.setUTCDate(availability.getUTCDate() + Math.ceil(input.releaseLagDays));
  const request = nextTransferRequestDate(availability, input.requestWeekdays);
  return request ? addBusinessDays(request, input.bankLagDays).toISOString().slice(0, 10) : null;
}

export function exclusiveAmazonCashItems(items: AmazonCashItem[]) {
  const selected = new Map<string, AmazonCashItem>();
  for (const item of items) {
    const current = selected.get(item.identity);
    if (!current || PRECEDENCE[item.state] > PRECEDENCE[current.state]) selected.set(item.identity, item);
  }
  return Array.from(selected.values());
}

export function scenarioAmount(item: AmazonCashItem, scenario: AmazonTreasuryScenario) {
  if (item.state === "RECEIVED" || !item.expectedBankDate) return 0;
  const amount = item.officialAmountEur ?? item.estimatedAmountEur;
  if (amount == null || amount <= 0) return 0;
  if (item.state === "PENDING_BANK") return amount;
  if (item.state === "AVAILABLE") return 0;
  // DEFERRED/FUTURE are cash only when the caller supplies an estimate derived
  // from observed release/net history. Missing evidence is deliberately zero,
  // never an embedded financial probability.
  return Math.max(0, item.scenarioAmountsEur?.[scenario] ?? 0);
}

export function buildMarketplaceCashCards(items: AmazonCashItem[]): AmazonMarketplaceCashCard[] {
  const exclusive = exclusiveAmazonCashItems(items);
  const groups = new Map<string, AmazonCashItem[]>();
  for (const item of exclusive) groups.set(item.marketplace, [...(groups.get(item.marketplace) ?? []), item]);
  return Array.from(groups.entries()).map(([marketplace, rows]) => {
    const currency = rows[0]?.originalCurrency ?? "EUR";
    const byState = (state: AmazonEconomicState) => rows.filter(row => row.state === state);
    const original = (state: AmazonEconomicState) => roundMoney(byState(state).reduce((sum, row) => sum + row.originalAmount, 0));
    const eur = (state: AmazonEconomicState) => {
      const selected = byState(state);
      if (selected.length === 0) return 0;
      const values = selected.map(row => row.officialAmountEur ?? row.estimatedAmountEur);
      return values.some(value => value == null) ? null : roundMoney(values.reduce((sum, value) => sum + Number(value), 0));
    };
    const economicValues = rows.filter(row => row.state !== "RECEIVED").map(row => row.officialAmountEur ?? row.estimatedAmountEur);
    const pendingDates = byState("PENDING_BANK").map(row => row.expectedBankDate).filter(Boolean).sort() as string[];
    const availableRequestDates=byState("AVAILABLE").map(row=>row.expectedRequestDate).filter(Boolean).sort() as string[];
    const availableArrival=availableRequestDates[0]?payoutArrivalWindow(availableRequestDates[0]):null;
    const pendingRequestDates=byState("PENDING_BANK").map(row=>row.actualRequestDate).filter(Boolean).sort() as string[];
    const pendingArrival=pendingRequestDates[0]?payoutArrivalWindow(pendingRequestDates[0]):null;
    return {
      marketplace,
      currency,
      availableOriginal: original("AVAILABLE"),
      availableEur: eur("AVAILABLE"),
      availablePositiveEur: (()=>{const values=byState("AVAILABLE").filter(row=>row.originalAmount>0).map(row=>row.officialAmountEur??row.estimatedAmountEur);return values.some(value=>value==null)?null:roundMoney(values.reduce((sum,value)=>sum+Number(value),0));})(),
      deferredOriginal: original("DEFERRED"),
      deferredEur: eur("DEFERRED"),
      pendingBankOriginal: original("PENDING_BANK"),
      pendingBankEur: eur("PENDING_BANK"),
      futureEur: eur("FUTURE") ?? 0,
      totalEconomicEur: economicValues.some(value => value == null) ? 0 : roundMoney(economicValues.reduce((sum, value) => sum + Number(value), 0)),
      expectedBankDate: pendingDates[0] ?? null,
      availableExpectedRequestDate:availableRequestDates[0]??null,
      availableArrivalBase:availableArrival?.base??null,
      availableArrivalConservative:availableArrival?.conservative??null,
      availableTiming:availableRequestDates[0]?"ESTIMATED_CONDITIONAL" as const:null,
      pendingBankArrivalBase:pendingArrival?.base??pendingDates[0]??null,
      pendingBankArrivalConservative:pendingArrival?.conservative??null,
      confidence: rows.map(row => row.confidence).sort()[0] ?? "unavailable",
      estimationMethod: Array.from(new Set(rows.map(row => row.estimationMethod))).join(" + "),
      lastSnapshotAt: rows.map(row=>row.snapshotAt).filter(Boolean).sort().at(-1)??null,
      fxSources: Array.from(new Set(rows.map(row=>row.fxSource).filter((value):value is string=>Boolean(value)))).sort(),
      fxRate: rows.map(row=>row.fxRate).find((value):value is number=>value!=null)??null,
      fxObservedAt: rows.map(row=>row.fxObservedAt).filter(Boolean).sort().at(-1)??null,
      containsEstimatedFx:rows.some(row=>row.fxSource==="ECB"),
    };
  }).sort((a, b) => a.marketplace.localeCompare(b.marketplace));
}

export function summarizeAmazonCashByMonth(items: AmazonCashItem[], months: string[]) {
  const exclusive = exclusiveAmazonCashItems(items);
  return months.map(month => ({
    month,
    conservative: roundMoney(exclusive.filter(item => item.expectedBankDate?.startsWith(month)).reduce((sum, item) => sum + scenarioAmount(item, "conservative"), 0)),
    base: roundMoney(exclusive.filter(item => item.expectedBankDate?.startsWith(month)).reduce((sum, item) => sum + scenarioAmount(item, "base"), 0)),
    optimistic: roundMoney(exclusive.filter(item => item.expectedBankDate?.startsWith(month)).reduce((sum, item) => sum + scenarioAmount(item, "optimistic"), 0)),
    observed: roundMoney(exclusive.filter(item => item.expectedBankDate?.startsWith(month) && item.state === "PENDING_BANK").reduce((sum, item) => sum + scenarioAmount(item, "base"), 0)),
    estimated: roundMoney(exclusive.filter(item => item.expectedBankDate?.startsWith(month) && ["DEFERRED", "FUTURE"].includes(item.state)).reduce((sum, item) => sum + scenarioAmount(item, "base"), 0)),
  }));
}
