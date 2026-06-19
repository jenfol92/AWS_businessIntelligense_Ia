/**
 * Verifica OWN_SALES_CORRECTED contra datos reales en Supabase.
 * Uso: npx tsx scripts/verify-stockout-correction.ts [sku...]
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeStockoutCorrection } from "../modules/planner/services/correctOwnSalesForStockouts";
import { buildStockoutCorrectionDebugPayload } from "../modules/planner/services/stockoutCorrectionDebug";

function loadEnvLocal() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o clave Supabase en .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const DEFAULT_SKUS = ["8436616610104", "8436616610098"];

async function fetchProductBySku(sku: string) {
  const { data, error } = await supabase
    .from("productos")
    .select("id, sku, nombre, parent_id")
    .eq("sku", sku)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function fetchMonthlySales(productId: string, year: number): Promise<number[]> {
  const monthly = Array.from({ length: 12 }, () => 0);
  const { data, error } = await supabase
    .from("ventas_diarias")
    .select("fecha, unidades_vendidas")
    .eq("producto_id", productId)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const m = Number(String(row.fecha).slice(5, 7)) - 1;
    if (m >= 0 && m < 12) {
      monthly[m] += Number(row.unidades_vendidas ?? 0);
    }
  }
  return monthly;
}

async function fetchStockByDate(
  productId: string,
  year: number,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const { data, error } = await supabase
    .from("v_product_fba_stock_daily")
    .select("snapshot_date, stock_sellable")
    .eq("producto_id", productId)
    .gte("snapshot_date", `${year}-01-01`)
    .lte("snapshot_date", `${year}-12-31`);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const date = String(row.snapshot_date).slice(0, 10);
    result.set(date, (result.get(date) ?? 0) + Number(row.stock_sellable ?? 0));
  }
  return result;
}

async function verifySku(sku: string, baseYear = 2025) {
  const product = await fetchProductBySku(sku);
  if (!product) {
    console.error(`SKU no encontrado: ${sku}`);
    return;
  }

  const monthlyOwnSales = await fetchMonthlySales(product.id, baseYear);
  const stockByDate = await fetchStockByDate(product.id, baseYear);

  const { data: stockSkus } = await supabase
    .from("v_product_fba_stock_daily")
    .select("sku_limpio")
    .eq("producto_id", product.id)
    .limit(10);

  const distinctSkus = Array.from(new Set((stockSkus ?? []).map((r) => r.sku_limpio)));

  const result = computeStockoutCorrection({
    country: "ALL",
    channel: "ALL",
    baseYear,
    monthlyOwnSales,
    stockByDate,
    channelAllowsCorrection: true,
    hasStockHistory: stockByDate.size > 0,
  });

  const debug = buildStockoutCorrectionDebugPayload({
    productId: product.id,
    sku: product.sku,
    method: "OWN_SALES_CORRECTED",
    country: "ALL",
    channel: "ALL",
    baseYear,
    actualMonthlySales: monthlyOwnSales,
    result,
  });

  console.log("\n===", sku, product.nombre, "===");
  console.log("productId:", product.id);
  console.log("parent_id:", product.parent_id);
  console.log("sku_limpio en ledger:", distinctSkus.join(", ") || "(ninguno)");
  console.log("producto_id ventas === ledger:", distinctSkus.length <= 1);
  console.log(JSON.stringify(debug, null, 2));
}

async function main() {
  const skus = process.argv.slice(2);
  const targets = skus.length > 0 ? skus : DEFAULT_SKUS;
  for (const sku of targets) {
    await verifySku(sku);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
