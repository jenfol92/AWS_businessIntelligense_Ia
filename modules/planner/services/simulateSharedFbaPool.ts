export type SharedFbaMarketplaceDemand = {
  marketplaceId: string;
  units: number;
};

export type SharedFbaPoolDay = {
  date: string;
  openingSellable: number;
  inboundBecomingSellable: number;
  demandByMarketplace: SharedFbaMarketplaceDemand[];
  totalDemand: number;
  servedUnits: number;
  lostSalesUnits: number;
  closingSellable: number;
};

/** Simula una sola posicion FBA compartida consumida por demanda concurrente. */
export function simulateSharedFbaPool(params: {
  openingSellable: number;
  days: Array<{
    date: string;
    inboundBecomingSellable?: number;
    demandByMarketplace: SharedFbaMarketplaceDemand[];
  }>;
}): SharedFbaPoolDay[] {
  let stock = Math.max(0, params.openingSellable);
  return params.days.map((day) => {
    const openingSellable = stock;
    const inboundBecomingSellable = Math.max(0, day.inboundBecomingSellable ?? 0);
    const totalDemand = day.demandByMarketplace.reduce(
      (sum, demand) => sum + Math.max(0, demand.units),
      0,
    );
    const available = openingSellable + inboundBecomingSellable;
    const servedUnits = Math.min(available, totalDemand);
    const lostSalesUnits = Math.max(0, totalDemand - available);
    stock = Math.max(0, available - totalDemand);
    return {
      date: day.date,
      openingSellable,
      inboundBecomingSellable,
      demandByMarketplace: day.demandByMarketplace,
      totalDemand,
      servedUnits,
      lostSalesUnits,
      closingSellable: stock,
    };
  });
}
