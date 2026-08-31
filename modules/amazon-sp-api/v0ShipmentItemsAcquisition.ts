import { mapGenericError, safeSpApiErrorMetadata } from "./errors.ts";
import { logInboundSpApiFailure } from "./inboundSyncErrorInstrumentation.ts";

/**
 * Amazon SP-API default for Fulfillment Inbound v0 getShipmentItemsByShipmentId.
 * @see https://developer-docs.amazon.com/sp-api/docs/fulfillment-inbound-api-rate-limits
 */
export const V0_SHIPMENT_ITEMS_RATE_LIMIT_REFERENCE =
  "Fulfillment Inbound v0 getShipmentItemsByShipmentId — 2 requests/second, burst 30 (Amazon SP-API official default)";

/** Conservative spacing: 600ms ≈ 1.67 req/s, below the 2 req/s sustained limit. */
export const V0_SHIPMENT_ITEMS_DELAY_MS = 600;

export type V0ShipmentItemsAcquisitionState = {
  itemsFetched: number;
  itemsSkippedAfterRateLimit: number;
  rateLimited: boolean;
  acquisitionComplete: boolean;
  retryAfter: string | null;
};

export function createV0ShipmentItemsAcquisitionState(): V0ShipmentItemsAcquisitionState {
  return {
    itemsFetched: 0,
    itemsSkippedAfterRateLimit: 0,
    rateLimited: false,
    acquisitionComplete: true,
    retryAfter: null,
  };
}

function isRateLimitError(error: unknown): boolean {
  const mapped = mapGenericError(error);
  return mapped.status === 429 || mapped.code === "rate_limited";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch v0 shipment items sequentially with fixed delay between calls.
 * On 429: stop further item calls, preserve prior results, mark acquisition partial.
 */
export async function fetchV0ShipmentItemsSequential<T>(params: {
  shipmentIds: string[];
  fetchItems: (shipmentId: string) => Promise<T[]>;
  state: V0ShipmentItemsAcquisitionState;
  delayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<Map<string, T[]>> {
  const delayMs = params.delayMs ?? V0_SHIPMENT_ITEMS_DELAY_MS;
  const sleepFn = params.sleepFn ?? defaultSleep;
  const itemsById = new Map<string, T[]>();

  for (let index = 0; index < params.shipmentIds.length; index += 1) {
    const shipmentId = params.shipmentIds[index];

    if (params.state.rateLimited) {
      params.state.itemsSkippedAfterRateLimit += 1;
      itemsById.set(shipmentId, []);
      continue;
    }

    try {
      const items = await params.fetchItems(shipmentId);
      itemsById.set(shipmentId, items);
      params.state.itemsFetched += 1;

      if (index < params.shipmentIds.length - 1) {
        await sleepFn(delayMs);
      }
    } catch (error) {
      if (!isRateLimitError(error)) throw error;

      logInboundSpApiFailure(error, {
        api: "fulfillment-inbound-v0",
        operation: `GET /fba/inbound/v0/shipments/${shipmentId}/items`,
      });
      const meta = safeSpApiErrorMetadata(error);
      params.state.rateLimited = true;
      params.state.acquisitionComplete = false;
      params.state.retryAfter = meta.retryAfter;
      itemsById.set(shipmentId, []);
      params.state.itemsSkippedAfterRateLimit += 1;

      for (let remaining = index + 1; remaining < params.shipmentIds.length; remaining += 1) {
        const skippedId = params.shipmentIds[remaining];
        params.state.itemsSkippedAfterRateLimit += 1;
        itemsById.set(skippedId, []);
      }
      break;
    }
  }

  return itemsById;
}

export function mergeV0ShipmentItemsAcquisitionState(
  active: V0ShipmentItemsAcquisitionState,
  terminal: V0ShipmentItemsAcquisitionState,
): V0ShipmentItemsAcquisitionState {
  return {
    itemsFetched: active.itemsFetched + terminal.itemsFetched,
    itemsSkippedAfterRateLimit:
      active.itemsSkippedAfterRateLimit + terminal.itemsSkippedAfterRateLimit,
    rateLimited: active.rateLimited || terminal.rateLimited,
    acquisitionComplete: active.acquisitionComplete && terminal.acquisitionComplete,
    retryAfter: terminal.retryAfter ?? active.retryAfter,
  };
}
