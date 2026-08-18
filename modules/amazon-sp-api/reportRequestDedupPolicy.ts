import { createHash } from "node:crypto";

type CompatibleReportJob = {
  marketplace_ids: string[] | null;
  raw: Record<string, unknown> | null;
};

export function normalizeMarketplaceSet(marketplaceIds: string[]): string[] {
  return Array.from(new Set(marketplaceIds.map((value) => value.trim()).filter(Boolean))).sort();
}

export function classifyOpenAmazonReportJob(params: {
  requestedAt: string;
  recentSince: Date;
}): "open_job" | "stale_open" {
  const requestedAt = Date.parse(params.requestedAt);
  return Number.isFinite(requestedAt) && requestedAt < params.recentSince.getTime()
    ? "stale_open"
    : "open_job";
}

export function stableReportRequestKey(params: {
  reportType: string;
  marketplaceIds: string[];
  requestKey?: Record<string, unknown>;
}): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, nested]) => [key, stable(nested)]),
      );
    }
    return value;
  };
  return JSON.stringify(stable({
    reportType: params.reportType,
    marketplaceIds: normalizeMarketplaceSet(params.marketplaceIds),
    requestKey: params.requestKey ?? {},
  }));
}

export function reportClaimUuid(params: {
  reportType: string;
  marketplaceIds: string[];
  requestKey?: Record<string, unknown>;
  now?: Date;
}): string {
  const now = params.now ?? new Date();
  const bucket = Math.floor(now.getTime() / (4 * 60 * 60 * 1000));
  const hex = createHash("sha256")
    .update(`${stableReportRequestKey(params)}|${bucket}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function isCompatibleAmazonReportJob(
  job: CompatibleReportJob,
  params: { marketplaceIds?: string[]; requestKey?: Record<string, unknown> },
): boolean {
  const requestedMarketplaces = normalizeMarketplaceSet(params.marketplaceIds ?? []);
  const jobMarketplaces = normalizeMarketplaceSet(job.marketplace_ids ?? []);
  if (
    requestedMarketplaces.length > 0 &&
    JSON.stringify(requestedMarketplaces) !== JSON.stringify(jobMarketplaces)
  ) {
    return false;
  }
  if (params.requestKey) {
    const payload = job.raw?.requestedCreateReportPayload;
    if (!payload || typeof payload !== "object") return false;
    for (const [key, value] of Object.entries(params.requestKey)) {
      if (JSON.stringify((payload as Record<string, unknown>)[key]) !== JSON.stringify(value)) {
        return false;
      }
    }
  }
  return true;
}
