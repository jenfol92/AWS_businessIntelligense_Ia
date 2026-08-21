import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [{ loadConfirmedOperationalAmazonSellerSkus }, requestModule] = await Promise.all([
  import("../modules/amazon-sp-api/operationalAmazonIdentityRepository.ts"),
  import("../modules/amazon-sp-api/inventorySummaryFilteredRequest.ts"),
]);

const { InventorySummaryRequestPacer, requestFilteredInventorySummaries, splitSellerSkuBatches } = requestModule;
const [marketplaceId, prefix] = process.argv.slice(2);
if (!marketplaceId || !prefix || !/^(es|gb)$/.test(prefix)) {
  throw new Error("USAGE: capture-inventory-summary-fixture.mts <marketplaceId> <es|gb>");
}

const sellerSkus = await loadConfirmedOperationalAmazonSellerSkus();
const batches = splitSellerSkuBatches(sellerSkus, 50);
if (batches.length !== 3) throw new Error(`UNEXPECTED_BATCH_COUNT:${batches.length}`);

const outputDirectory = resolve("modules/amazon-sp-api/fixtures/es-gb-comparison-20260820");
await mkdir(outputDirectory, { recursive: true });
const pacer = new InventorySummaryRequestPacer();

console.log(JSON.stringify({ phase: prefix.toUpperCase(), marketplaceId, confirmedSetSize: sellerSkus.length, batchSizes: batches.map((batch) => batch.length) }));

for (let index = 0; index < batches.length; index += 1) {
  const batchNumber = index + 1;
  let responseMetadata: Record<string, unknown> | null = null;
  const startedAt = new Date().toISOString();
  const response = await pacer.run(() => requestFilteredInventorySummaries({
    marketplaceId,
    sellerSkus: batches[index],
    onResponseMetadata(metadata) {
      pacer.observeRateLimit(metadata.observedRateLimit);
      responseMetadata = {
        status: metadata.status,
        requestId: metadata.requestId,
        observedRateLimit: metadata.observedRateLimit,
        retryAfter: metadata.retryAfter,
        observedAt: metadata.observedAt,
      };
    },
  }));
  const inventorySummaries = response.inventorySummaries ?? response.payload?.inventorySummaries ?? [];
  const fixture = {
    capturedAt: new Date().toISOString(),
    startedAt,
    marketplaceId,
    batchNumber,
    requestedSellerSkus: batches[index],
    responseMetadata,
    pagination: response.pagination ?? null,
    inventorySummaries,
  };
  const path = resolve(outputDirectory, `${prefix}-batch-${batchNumber}.json`);
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ phase: prefix.toUpperCase(), batchNumber, rows: inventorySummaries.length, nextTokenPresent: Boolean(response.pagination?.nextToken), path }));
  if (response.pagination?.nextToken) throw new Error(`UNEXPECTED_PAGINATION:${prefix}:batch-${batchNumber}`);
}
