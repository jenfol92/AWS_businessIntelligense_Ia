import { supabaseAdmin } from "@/server/supabase/adminClient";
import { importFbaInventorySnapshotFromSpApi } from "./fbaForecastSpApiImportsService";
import { mapGenericError } from "./errors";
import {
  AMAZON_INVENTORY_CANONICAL_FREQUENCY_MINUTES,
  AMAZON_INVENTORY_RATE_LIMIT_COOLDOWN_MINUTES,
  resolveCanonicalInventorySyncGate,
} from "./amazonInventorySyncGate";
import { runWithCanonicalSyncLease } from "./canonicalSyncCoordinator";
import { loadConfirmedOperationalAmazonSellerSkus } from "./operationalAmazonIdentityRepository";
import {
  UK_REFERENCE_MARKETPLACE_ID,
  resolvePublishedInventoryMarketplaceIds,
} from "./inventorySummaryPoolPolicy";

export { AMAZON_INVENTORY_CANONICAL_FREQUENCY_MINUTES } from "./amazonInventorySyncGate";

export const AMAZON_INVENTORY_CANONICAL_JOB_KEY = "amazon_inventory_canonical";

type GateState = {
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
};

export type CanonicalInventorySyncResult = {
  action: "synced" | "skipped_fresh" | "skipped_rate_limit" | "skipped_running";
  startedAt: string;
  finishedAt: string;
  inventory?: Awaited<ReturnType<typeof importFbaInventorySnapshotFromSpApi>>;
};

export type CanonicalInventorySyncDependencies = {
  now: () => Date;
  gateState: () => Promise<GateState>;
  acquireLease: (input: { at: string; observed: GateState }) => Promise<boolean>;
  persistResult: (input: {
    ownerStartedAt: string;
    status: "SUCCESS" | "ERROR" | "RATE_LIMITED";
    at: string;
    error?: string | null;
    rows?: number | null;
  }) => Promise<void>;
  inventory: typeof importFbaInventorySnapshotFromSpApi;
  confirmedSellerSkus?: () => Promise<string[]>;
};

const defaultDependencies: CanonicalInventorySyncDependencies = {
  now: () => new Date(),
  async gateState() {
    const { data, error } = await supabaseAdmin
      .from("amazon_sync_jobs")
      .select("last_success_at,last_run_at,last_status")
      .eq("job_key", AMAZON_INVENTORY_CANONICAL_JOB_KEY)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      lastSuccessAt: (data?.last_success_at as string | null | undefined) ?? null,
      lastRunAt: (data?.last_run_at as string | null | undefined) ?? null,
      lastStatus: (data?.last_status as string | null | undefined) ?? null,
    };
  },
  async acquireLease({ at, observed }) {
    let request = supabaseAdmin
      .from("amazon_sync_jobs")
      .update({
        last_run_at: at,
        last_status: "RUNNING",
        last_error: null,
        next_run_hint: "Manual en desarrollo; cron existente tras deployment. Intervalo minimo 4 h.",
        updated_at: at,
      })
      .eq("job_key", AMAZON_INVENTORY_CANONICAL_JOB_KEY);
    request = observed.lastStatus == null
      ? request.is("last_status", null)
      : request.eq("last_status", observed.lastStatus);
    request = observed.lastRunAt == null
      ? request.is("last_run_at", null)
      : request.eq("last_run_at", observed.lastRunAt);
    const { data, error } = await request.select("job_key").maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
  },
  async persistResult(input) {
    const { data, error } = await supabaseAdmin
      .from("amazon_sync_jobs")
      .update({
        last_run_at: input.at,
        ...(input.status === "SUCCESS" ? { last_success_at: input.at } : {}),
        last_status: input.status,
        last_error: input.error ?? null,
        last_rows_upserted: input.rows ?? null,
        next_run_hint: input.status === "RATE_LIMITED"
          ? `No reintentar antes de ${new Date(new Date(input.at).getTime() + AMAZON_INVENTORY_RATE_LIMIT_COOLDOWN_MINUTES * 60_000).toISOString()}.`
          : "Manual en desarrollo; cron existente tras deployment. Intervalo minimo 4 h.",
        updated_at: input.at,
      })
      .eq("job_key", AMAZON_INVENTORY_CANONICAL_JOB_KEY)
      .eq("last_status", "RUNNING")
      .eq("last_run_at", input.ownerStartedAt)
      .select("job_key")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("La lease del sync Amazon expiro o cambio de propietario.");
  },
  inventory: importFbaInventorySnapshotFromSpApi,
  confirmedSellerSkus: loadConfirmedOperationalAmazonSellerSkus,
};

export async function syncAmazonInventoryCanonical(
  options: {
    force?: boolean;
    marketplaceIds?: string[];
    publishSnapshot?: boolean;
    maxBatches?: number;
    stopOnNextToken?: boolean;
  } = {},
  dependencies: CanonicalInventorySyncDependencies = defaultDependencies,
): Promise<CanonicalInventorySyncResult> {
  const started = dependencies.now();
  const startedAt = started.toISOString();
  let observed: GateState | null = null;
  const coordinated = await runWithCanonicalSyncLease({
    async gateAction() {
      observed = await dependencies.gateState();
      return resolveCanonicalInventorySyncGate({ now: started, force: options.force, ...observed });
    },
    acquireLease: () => dependencies.acquireLease({ at: startedAt, observed: observed! }),
    async execute() {
      try {
        const confirmedSellerSkus = await (dependencies.confirmedSellerSkus ?? loadConfirmedOperationalAmazonSellerSkus)();
        const marketplaceIds = resolvePublishedInventoryMarketplaceIds(options.marketplaceIds);
        if (options.publishSnapshot !== false && marketplaceIds.includes(UK_REFERENCE_MARKETPLACE_ID)) {
          throw new Error("DUAL_OPERATIONAL_POOL_PUBLICATION_NOT_ENABLED");
        }
        const inventory = await dependencies.inventory({
          marketplaceIds,
          sellerSkus: confirmedSellerSkus,
          sellerSkuBatchSize: 50,
          maxBatches: options.maxBatches,
          persistSnapshot: options.publishSnapshot !== false,
          includeObservations: options.publishSnapshot === false,
          stopOnNextToken: options.stopOnNextToken,
        });
        const finishedAt = dependencies.now().toISOString();
        await dependencies.persistResult({
          ownerStartedAt: startedAt,
          status: "SUCCESS",
          at: finishedAt,
          rows: inventory.rowsUpserted,
        });
        return { action: "synced" as const, startedAt, finishedAt, inventory };
      } catch (error) {
        const finishedAt = dependencies.now().toISOString();
        const mapped = mapGenericError(error);
        await dependencies.persistResult({
          ownerStartedAt: startedAt,
          status: mapped.code === "rate_limited" || mapped.status === 429 ? "RATE_LIMITED" : "ERROR",
          at: finishedAt,
          error: mapped.message,
        });
        throw error;
      }
    },
  });
  if (coordinated.action !== "owned") {
    return { action: coordinated.action, startedAt, finishedAt: startedAt };
  }
  return coordinated.value;
}
