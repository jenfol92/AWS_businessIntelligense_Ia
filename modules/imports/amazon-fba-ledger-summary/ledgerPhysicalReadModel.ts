export type LedgerPhysicalContribution = {
  asin: string;
  fnsku: string;
  sellerSkuAliases: string[];
  locationRaw: string;
  disposition: string;
  conditionType: string | null;
  quantity: number;
};

export type LedgerPhysicalSummary = {
  sellable: number;
  newSellable: number;
  usedSellable: number;
  unknownConditionSellable: number;
  unsellable: number;
  physicalTotal: number;
  uniqueFnskuCount: number;
  sellerSkuAliases: string[];
};

function conditionBucket(value: string | null): "NEW" | "USED" | "UNKNOWN" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "NEW" || normalized === "NEWITEM") return "NEW";
  if (normalized && normalized !== "UNKNOWN") return "USED";
  return "UNKNOWN";
}

export function summarizeLedgerPhysicalRows(
  rows: LedgerPhysicalContribution[],
): LedgerPhysicalSummary {
  let sellable = 0;
  let newSellable = 0;
  let usedSellable = 0;
  let unknownConditionSellable = 0;
  let unsellable = 0;
  const fnskus = new Set<string>();
  const aliases = new Set<string>();

  for (const row of rows) {
    fnskus.add(row.fnsku);
    row.sellerSkuAliases.forEach((alias) => aliases.add(alias));
    const quantity = Number(row.quantity) || 0;
    if (row.disposition.trim().toUpperCase() === "SELLABLE") {
      sellable += quantity;
      const bucket = conditionBucket(row.conditionType);
      if (bucket === "NEW") newSellable += quantity;
      else if (bucket === "USED") usedSellable += quantity;
      else unknownConditionSellable += quantity;
    } else {
      unsellable += quantity;
    }
  }

  return {
    sellable,
    newSellable,
    usedSellable,
    unknownConditionSellable,
    unsellable,
    physicalTotal: sellable + unsellable,
    uniqueFnskuCount: fnskus.size,
    sellerSkuAliases: Array.from(aliases).sort(),
  };
}
