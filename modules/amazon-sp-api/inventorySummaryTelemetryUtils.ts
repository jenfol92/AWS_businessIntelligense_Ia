import { createHash, randomUUID } from "node:crypto";

export function sellerSkusSafeHash(values: readonly string[]): string {
  return createHash("sha256").update(values.map((value) => value.trim()).filter(Boolean).join("\u0000")).digest("hex");
}

export function newInventoryAttemptId(): string {
  return randomUUID();
}

export function inventoryOperationalPool(marketplaceId: string): "EU" | "UK" | "UNKNOWN" {
  return marketplaceId === "A1F83G8C2ARO7P" ? "UK" : marketplaceId ? "EU" : "UNKNOWN";
}
