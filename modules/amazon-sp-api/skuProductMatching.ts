import { supabaseAdmin } from "@/server/supabase/adminClient";
import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import {
  loadConfirmedOperationalAmazonIdentities,
  type ConfirmedOperationalAmazonIdentity,
} from "./operationalAmazonIdentityRepository";
import { resolveOperationalAmazonIdentity } from "./amazonInventoryIdentityResolver";

export type ProductMatch = {
  productoId: string | null;
  matchedBy: string | null;
  skuLimpio: string | null;
  candidates: string[];
  expectedAsin?: string | null;
  resolutionStatus?: "IDENTITY_RESOLVED_BY_ALIAS" | "IDENTITY_RESOLVED_BY_ASIN" | "IDENTITY_RESOLVED_BY_LEGACY_SKU" | "IDENTITY_INCOMPLETE" | "IDENTITY_AMBIGUOUS" | "ASIN_IDENTITY_CONFLICT";
  aliasStatus?: "ALIAS_CANDIDATE_BY_ASIN" | null;
};

export type SkuIdentityRequest = { sellerSku: string | null | undefined; asin?: string | null };

export function inventoryIdentityKey(sellerSku: string, asin: string | null | undefined): string {
  return `${sellerSku.trim()}\u0000${String(asin ?? "").trim().toUpperCase()}`;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function normalizeComparable(value: string | null | undefined): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

export function buildSkuCandidates(sku: string | null | undefined): {
  skuLimpio: string | null;
  candidates: string[];
} {
  const original = String(sku ?? "").trim();
  const normalized = normalizeComparable(original);
  const twinly = extractTwinlySkuFromSellerSku(original);
  const eans = Array.from(original.matchAll(/\d{13}/g)).map((m) => m[0]);
  const digits = original.replace(/\D/g, "");

  return {
    skuLimpio: twinly ?? eans[0] ?? normalized ?? (original || null),
    candidates: uniq([
      original,
      normalized ?? "",
      twinly ?? "",
      ...eans,
      digits,
    ]),
  };
}

export async function resolveProductMatchesBySku(
  skus: Array<string | null | undefined> | SkuIdentityRequest[],
  options: {
    operationalIdentities?: readonly ConfirmedOperationalAmazonIdentity[];
    loadOperationalIdentities?: () => Promise<ConfirmedOperationalAmazonIdentity[]>;
  } = {},
): Promise<Map<string, ProductMatch>> {
  const requests: SkuIdentityRequest[] = skus.map((value) => typeof value === "object" && value !== null
    ? value
    : { sellerSku: value as string | null | undefined });
  const operationalIdentities = options.operationalIdentities
    ?? await (options.loadOperationalIdentities ?? loadConfirmedOperationalAmazonIdentities)();
  const confirmedByAlias = new Map<string, ConfirmedOperationalAmazonIdentity[]>();
  const confirmedByAsin = new Map<string, ConfirmedOperationalAmazonIdentity[]>();
  for (const identity of operationalIdentities) {
    confirmedByAlias.set(identity.sellerSku, [...(confirmedByAlias.get(identity.sellerSku) ?? []), identity]);
    confirmedByAsin.set(identity.asin, [...(confirmedByAsin.get(identity.asin) ?? []), identity]);
  }
  const byOriginalSku = new Map<string, ProductMatch>();
  const allCandidates = new Set<string>();
  const builtBySku = new Map<string, ReturnType<typeof buildSkuCandidates>>();

  for (const request of requests) {
    const key = String(request.sellerSku ?? "").trim();
    if (!key) continue;
    const asin = String(request.asin ?? "").trim().toUpperCase();
    const aliases = confirmedByAlias.get(key) ?? [];
    const aliasProducts = new Set(aliases.map((identity) => `${identity.productoId}\u0000${identity.asin}`));
    if (aliases.length > 0 && aliasProducts.size === 1) continue;
    if (aliases.length > 0 || (asin && (confirmedByAsin.get(asin) ?? []).length > 0)) continue;
    const built = buildSkuCandidates(key);
    builtBySku.set(key, built);
    for (const candidate of built.candidates) allCandidates.add(candidate);
  }

  const candidates = Array.from(allCandidates);
  const productByCandidate = new Map<string, Map<string, { id: string; matchedBy: string }>>();
  const addCandidateMatch = (candidate: string, value: { id: string; matchedBy: string }) => {
    const matches = productByCandidate.get(candidate) ?? new Map<string, { id: string; matchedBy: string }>();
    matches.set(value.id, value);
    productByCandidate.set(candidate, matches);
  };

  if (candidates.length > 0) {
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      const { data: products, error: productError } = await supabaseAdmin
        .from("productos")
        .select("id, sku")
        .in("sku", chunk);

      if (productError) throw new Error(productError.message);

      for (const row of products ?? []) {
        const id = String((row as { id?: string }).id ?? "");
        const skuValue = String((row as { sku?: string }).sku ?? "").trim();
        if (!id || !skuValue) continue;
        addCandidateMatch(skuValue, { id, matchedBy: "productos.sku" });
        const normalized = normalizeComparable(skuValue);
        if (normalized) {
          addCandidateMatch(normalized, {
            id,
            matchedBy: "productos.sku_normalizado",
          });
        }
      }

      const { data: logistics, error: logisticsError } = await supabaseAdmin
        .from("producto_logistica")
        .select("producto_id, ean_upc")
        .in("ean_upc", chunk);

      if (logisticsError) throw new Error(logisticsError.message);

      for (const row of logistics ?? []) {
        const id = String((row as { producto_id?: string }).producto_id ?? "");
        const ean = String((row as { ean_upc?: string }).ean_upc ?? "").trim();
        if (!id || !ean) continue;
        addCandidateMatch(ean, { id, matchedBy: "producto_logistica.ean_upc" });
        const normalized = normalizeComparable(ean);
        if (normalized) {
          addCandidateMatch(normalized, {
            id,
            matchedBy: "producto_logistica.ean_upc_normalizado",
          });
        }
      }
    }
  }

  for (const request of requests) {
    const sku = String(request.sellerSku ?? "").trim();
    if (!sku) continue;
    const asin = String(request.asin ?? "").trim().toUpperCase();
    const key = inventoryIdentityKey(sku, asin);
    const operational = resolveOperationalAmazonIdentity(sku, asin, operationalIdentities);
    if (operational.status !== "UNRESOLVED") {
      const match: ProductMatch = {
        productoId: operational.productoId,
        matchedBy: operational.resolutionSource,
        skuLimpio: operational.skuLimpio,
        candidates: [],
        expectedAsin: operational.expectedAsin,
        resolutionStatus: operational.status,
        aliasStatus: operational.aliasStatus,
      };
      byOriginalSku.set(key, match);
      if (!request.asin) byOriginalSku.set(sku, match);
      continue;
    }
    const built = builtBySku.get(sku) ?? buildSkuCandidates(sku);
    let match: ProductMatch = {
      productoId: null,
      matchedBy: null,
      skuLimpio: built.skuLimpio,
      candidates: built.candidates,
      resolutionStatus: "IDENTITY_INCOMPLETE",
    };

    const legacyMatches = new Map<string, { id: string; matchedBy: string }>();
    for (const candidate of built.candidates) {
      for (const found of Array.from(productByCandidate.get(candidate)?.values() ?? [])) legacyMatches.set(found.id, found);
      for (const found of Array.from(productByCandidate.get(normalizeComparable(candidate) ?? "")?.values() ?? [])) legacyMatches.set(found.id, found);
    }
    if (legacyMatches.size === 1) {
      const found = Array.from(legacyMatches.values())[0];
      match = {
        productoId: found.id,
        matchedBy: found.matchedBy,
        skuLimpio: built.skuLimpio,
        candidates: built.candidates,
        resolutionStatus: "IDENTITY_RESOLVED_BY_LEGACY_SKU",
      };
    } else if (legacyMatches.size > 1) {
      match.resolutionStatus = "IDENTITY_AMBIGUOUS";
    }

    byOriginalSku.set(key, match);
    if (!request.asin) byOriginalSku.set(sku, match);
  }

  return byOriginalSku;
}
