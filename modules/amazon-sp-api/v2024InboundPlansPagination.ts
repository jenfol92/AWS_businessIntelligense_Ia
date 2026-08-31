type RequestInput = {
  method: "GET";
  path: string;
  query: Record<string, string | undefined>;
};

type RequestFn = (input: RequestInput) => Promise<unknown>;

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RawRecord
    : {};
}

function plansFrom(response: unknown): unknown[] {
  const root = asRecord(response);
  const payload = asRecord(root.payload);
  const plans = root.inboundPlans ?? root.plans ?? payload.inboundPlans ?? payload.plans;
  return Array.isArray(plans) ? plans : [];
}

export function extractV2024PaginationToken(response: unknown): string | null {
  const root = asRecord(response);
  const payload = asRecord(root.payload);
  const pagination = asRecord(root.pagination ?? payload.pagination);
  const value =
    root.paginationToken ??
    pagination.nextToken ??
    pagination.paginationToken ??
    root.nextToken ??
    payload.paginationToken ??
    payload.nextToken;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function paginateV2024InboundPlans(params: {
  request: RequestFn;
  maxPages: number;
}): Promise<{
  plans: unknown[];
  pagesFetched: number;
  acquisitionComplete: boolean;
}> {
  const plans: unknown[] = [];
  const seenTokens = new Set<string>();
  let paginationToken: string | null = null;
  let pagesFetched = 0;
  let paginationExhausted = false;

  while (pagesFetched < params.maxPages) {
    const response = await params.request({
      method: "GET",
      path: "/inbound/fba/2024-03-20/inboundPlans",
      query: {
        pageSize: "30",
        ...(paginationToken ? { paginationToken } : {}),
      },
    });

    pagesFetched += 1;
    plans.push(...plansFrom(response));

    const newToken = extractV2024PaginationToken(response);
    if (!newToken) {
      paginationExhausted = true;
      break;
    }
    if (seenTokens.has(newToken)) break;

    seenTokens.add(newToken);
    paginationToken = newToken;
  }

  return {
    plans,
    pagesFetched,
    acquisitionComplete: paginationExhausted,
  };
}
