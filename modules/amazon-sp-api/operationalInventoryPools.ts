import {
  buildCanonicalFnsSkuContributors,
  type CanonicalFnsSkuContributor,
  type FnsSkuInventoryObservation,
} from "./inventorySummaryFnskuCanonical.ts";

export type OperationalInventoryPool = "PAN_EU" | "UK";

export type OperationalPoolProductStock = {
  productoId: string;
  asin: string;
  stockFbaPanEu: number;
  stockFbaUk: number;
  stockFbaTotal: number;
  panEuContributors: CanonicalFnsSkuContributor[];
  ukContributors: CanonicalFnsSkuContributor[];
};

export type OperationalPoolInventoryModel = {
  products: OperationalPoolProductStock[];
  contributors: CanonicalFnsSkuContributor[];
  conflicts: CanonicalFnsSkuContributor[];
  completePools: Record<OperationalInventoryPool, boolean>;
  readyForAtomicPublication: boolean;
};

export function buildOperationalPoolInventoryModel(params: {
  observations: readonly FnsSkuInventoryObservation[];
  completePools: Record<OperationalInventoryPool, boolean>;
}): OperationalPoolInventoryModel {
  const contributors = buildCanonicalFnsSkuContributors(params.observations);
  const conflicts = contributors.filter((row) => row.status === "FNSKU_IDENTITY_CONFLICT");
  const products = new Map<string, OperationalPoolProductStock>();

  for (const contributor of contributors) {
    if (contributor.status !== "CONFIRMED" || !contributor.quantities) continue;
    if (contributor.operationalPool !== "PAN_EU" && contributor.operationalPool !== "UK") continue;
    const key = `${contributor.productoId}|${contributor.asin}`;
    const product = products.get(key) ?? {
      productoId: contributor.productoId,
      asin: contributor.asin,
      stockFbaPanEu: 0,
      stockFbaUk: 0,
      stockFbaTotal: 0,
      panEuContributors: [],
      ukContributors: [],
    };
    if (contributor.operationalPool === "PAN_EU") {
      product.stockFbaPanEu += contributor.quantities.fulfillableQuantity;
      product.panEuContributors.push(contributor);
    } else {
      product.stockFbaUk += contributor.quantities.fulfillableQuantity;
      product.ukContributors.push(contributor);
    }
    product.stockFbaTotal = product.stockFbaPanEu + product.stockFbaUk;
    products.set(key, product);
  }

  return {
    products: Array.from(products.values()).sort((left, right) =>
      `${left.productoId}|${left.asin}`.localeCompare(`${right.productoId}|${right.asin}`),
    ),
    contributors,
    conflicts,
    completePools: { ...params.completePools },
    readyForAtomicPublication:
      params.completePools.PAN_EU && params.completePools.UK && conflicts.length === 0,
  };
}
