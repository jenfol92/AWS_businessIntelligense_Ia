const { loadEnvConfig } = require("@next/env");
const { createClient } = require("@supabase/supabase-js");
loadEnvConfig(process.cwd());
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function allRows(table, select) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select(select).range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
function clean(v) { return String(v ?? "").trim(); }
function pool(country) {
  const c = clean(country).toUpperCase();
  return c === "GB" || c === "UK" ? "UK" : c ? "EU" : "UNKNOWN";
}
function add(map, key, value) { const s = map.get(key) ?? new Set(); s.add(value); map.set(key, s); }

(async () => {
  const [ledger, country] = await Promise.all([
    allRows("amazon_fba_inventory_ledger_daily", "producto_id,sku_original,msku_aliases,asin,fnsku,snapshot_date,location,location_country,disposition,ending_warehouse_balance"),
    allRows("fba_country_stock_daily", "producto_id,sku_limpio,marketplace_country,snapshot_date,raw,stock_fba"),
  ]);
  const targetAsin = "B0DJBQGKBT";
  const sellerToFnsku = new Map();
  const fnskuToSeller = new Map();
  const fnskuToAsinProduct = new Map();
  const targetSeller = new Set();
  const targetFnsku = new Set();
  for (const row of ledger) {
    const asin = clean(row.asin).toUpperCase(); const fnsku = clean(row.fnsku).toUpperCase(); const product = clean(row.producto_id); const sku = clean(row.sku_original);
    if (sku && fnsku) { sellerToFnsku.set(sku, fnsku); add(fnskuToSeller, fnsku, sku); }
    if (fnsku && asin) add(fnskuToAsinProduct, fnsku, `${asin}|${product}`);
    if (asin === targetAsin && sku && fnsku) { targetSeller.add(sku); targetFnsku.add(fnsku); }
  }
  for (const row of country) {
    const sources = Array.isArray(row.raw?.sources) ? row.raw.sources : [];
    for (const source of sources) {
      const raw = source?.raw ?? {};
      const sku = clean(source?.sellerSku); const fnsku = clean(raw["fulfillment-channel-sku"] ?? raw["fulfillment_channel_sku"] ?? raw.fnsku).toUpperCase();
      const asin = clean(raw.asin).toUpperCase(); const product = clean(row.producto_id);
      if (sku && fnsku) { sellerToFnsku.set(sku, fnsku); add(fnskuToSeller, fnsku, sku); }
      if (fnsku && asin) add(fnskuToAsinProduct, fnsku, `${asin}|${product}`);
      if (asin === targetAsin && sku && fnsku) { targetSeller.add(sku); targetFnsku.add(fnsku); }
    }
  }
  const conflicts = [];
  const group = new Map();
  for (const row of ledger) {
    const fnsku = clean(row.fnsku).toUpperCase(); const sku = clean(row.sku_original); const product = clean(row.producto_id); const date = clean(row.snapshot_date); const p = pool(row.location_country || row.location); if (!fnsku || !sku || !product || !date) continue;
    const key = `${product}|${p}|${fnsku}|${date}`; const bySku = group.get(key) ?? new Map();
    const current = bySku.get(sku) ?? 0; bySku.set(sku, current + Number(row.ending_warehouse_balance ?? 0)); group.set(key, bySku);
  }
  for (const [key, bySku] of group) {
    const values = [...bySku.values()];
    if (bySku.size > 1 && new Set(values).size > 1) conflicts.push({ key, sellerSkuQuantities: Object.fromEntries(bySku) });
  }
  console.log(JSON.stringify({
    rowCounts: { ledger: ledger.length, byCountry: country.length },
    target: { sellerSkus: [...targetSeller].sort(), fnskus: [...targetFnsku].sort() },
    global: {
      distinctSellerSkus: sellerToFnsku.size,
      distinctFnskus: fnskuToSeller.size,
      multiSellerSkuFnskus: [...fnskuToSeller.entries()].filter(([, s]) => s.size > 1).map(([fnsku, s]) => ({ fnsku, sellerSkus: [...s].sort() })).sort((a,b) => b.sellerSkus.length-a.sellerSkus.length),
      fnskuAsinProductConflicts: [...fnskuToAsinProduct.entries()].filter(([, s]) => s.size > 1).map(([fnsku, s]) => ({ fnsku, asinProducts: [...s].sort() })),
      sameProductPoolFnskuQuantityConflicts: conflicts.slice(0, 100),
      sameProductPoolFnskuQuantityConflictCount: conflicts.length,
    },
  }, null, 2));
})().catch((e) => { console.error(JSON.stringify({ error: e.message }, null, 2)); process.exitCode = 1; });
