import { supabaseAdmin } from "@/server/supabase/adminClient";
import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";

export type ProductMatch = {
  productoId: string | null;
  matchedBy: string | null;
  skuLimpio: string | null;
  candidates: string[];
};

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
  skus: Array<string | null | undefined>,
): Promise<Map<string, ProductMatch>> {
  const byOriginalSku = new Map<string, ProductMatch>();
  const allCandidates = new Set<string>();
  const builtBySku = new Map<string, ReturnType<typeof buildSkuCandidates>>();

  for (const sku of skus) {
    const key = String(sku ?? "").trim();
    if (!key) continue;
    const built = buildSkuCandidates(key);
    builtBySku.set(key, built);
    for (const candidate of built.candidates) allCandidates.add(candidate);
  }

  const candidates = Array.from(allCandidates);
  const productByCandidate = new Map<string, { id: string; matchedBy: string }>();

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
        productByCandidate.set(skuValue, { id, matchedBy: "productos.sku" });
        const normalized = normalizeComparable(skuValue);
        if (normalized) {
          productByCandidate.set(normalized, {
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
        productByCandidate.set(ean, { id, matchedBy: "producto_logistica.ean_upc" });
        const normalized = normalizeComparable(ean);
        if (normalized) {
          productByCandidate.set(normalized, {
            id,
            matchedBy: "producto_logistica.ean_upc_normalizado",
          });
        }
      }
    }
  }

  for (const [sku, built] of Array.from(builtBySku.entries())) {
    let match: ProductMatch = {
      productoId: null,
      matchedBy: null,
      skuLimpio: built.skuLimpio,
      candidates: built.candidates,
    };

    for (const candidate of built.candidates) {
      const found =
        productByCandidate.get(candidate) ??
        productByCandidate.get(normalizeComparable(candidate) ?? "");
      if (!found) continue;
      match = {
        productoId: found.id,
        matchedBy: found.matchedBy,
        skuLimpio: built.skuLimpio,
        candidates: built.candidates,
      };
      break;
    }

    byOriginalSku.set(sku, match);
  }

  return byOriginalSku;
}
