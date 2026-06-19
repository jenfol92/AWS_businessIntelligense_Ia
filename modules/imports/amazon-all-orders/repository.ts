import { supabaseAdmin } from "@/server/supabase/adminClient";
import { resolveAmazonMarketplaceId } from "@/modules/imports/shared/amazonMarketplaceIds";
import {
  isStagingRowEligibleForVentas,
  mapCanalVentaToVentasDiarias,
} from "./mappers";
import type {
  AmazonAllOrdersDbRow,
  ParsedAmazonAllOrdersRow,
  VentasDiariasUpsertRow,
} from "./types";

const UPSERT_BATCH_SIZE = 200;

function dedupeByFingerprint(rows: AmazonAllOrdersDbRow[]): AmazonAllOrdersDbRow[] {
  const map = new Map<string, AmazonAllOrdersDbRow>();
  for (const row of rows) {
    map.set(row.row_fingerprint, row);
  }
  return Array.from(map.values());
}

export async function loadProductIdsBySku(
  skus: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;

  const uniqueSkus = Array.from(new Set(skus));
  for (let i = 0; i < uniqueSkus.length; i += 500) {
    const chunk = uniqueSkus.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from("productos")
      .select("id, sku")
      .in("sku", chunk);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const sku = String((row as { sku?: string }).sku ?? "").trim();
      const id = String((row as { id?: string }).id ?? "");
      if (sku && id) map.set(sku, id);
    }
  }

  return map;
}

export function mapAllOrdersRowsToDbPayload(params: {
  rows: ParsedAmazonAllOrdersRow[];
  productoBySku: Map<string, string>;
  source: string;
  sourceFileName: string | null;
}): AmazonAllOrdersDbRow[] {
  const now = new Date().toISOString();

  return params.rows.map((row) => ({
    producto_id: params.productoBySku.get(row.skuLimpio) ?? null,
    amazon_order_id: row.amazonOrderId || "",
    merchant_order_id: row.merchantOrderId || "",
    order_item_id: row.orderItemId || "",
    purchase_datetime: row.purchaseDatetime,
    purchase_date: row.purchaseDate,
    last_updated_datetime: row.lastUpdatedDatetime,
    order_status: row.orderStatus || "",
    item_status: row.itemStatus || "",
    fulfillment_channel: row.fulfillmentChannel || "",
    sales_channel: row.salesChannel || "",
    marketplace_country: row.marketplaceCountry || "UNKNOWN",
    ship_country: row.shipCountry || "",
    sku_original: row.skuOriginal || "",
    sku_limpio: row.skuLimpio,
    asin: row.asin || "",
    product_name: row.productName,
    quantity: row.quantity,
    currency: row.currency || "EUR",
    item_price: row.itemPrice,
    item_tax: row.itemTax,
    shipping_price: row.shippingPrice,
    shipping_tax: row.shippingTax,
    gift_wrap_price: row.giftWrapPrice,
    gift_wrap_tax: row.giftWrapTax,
    item_promotion_discount: row.itemPromotionDiscount,
    ship_promotion_discount: row.shipPromotionDiscount,
    is_business_order: row.isBusinessOrder,
    canal_venta: row.canalVenta,
    row_fingerprint: row.rowFingerprint,
    source: params.source,
    source_file_name: params.sourceFileName,
    raw: row.raw,
    updated_at: now,
  }));
}

export async function upsertAmazonAllOrdersItems(
  rows: AmazonAllOrdersDbRow[],
): Promise<number> {
  const dedupedRows = dedupeByFingerprint(rows);
  if (dedupedRows.length === 0) return 0;

  let affected = 0;
  for (let i = 0; i < dedupedRows.length; i += UPSERT_BATCH_SIZE) {
    const batch = dedupedRows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from("amazon_all_orders_items")
      .upsert(batch, { onConflict: "row_fingerprint" });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return affected;
}

type StagingAggregateRow = {
  producto_id: string;
  purchase_date: string;
  marketplace_country: string;
  canal_venta: string;
  currency: string;
  sales_channel: string;
  is_business_order: boolean;
  quantity: number;
  gross: number;
  tax: number;
};

function aggregateStagingRows(
  rows: StagingAggregateRow[],
  marketplaceIdByCode: Map<string, string>,
  source: string,
): { rows: VentasDiariasUpsertRow[]; warnings: string[] } {
  const grouped = new Map<string, VentasDiariasUpsertRow>();
  const warningSet = new Set<string>();

  for (const row of rows) {
    const marketplaceCode = String(row.marketplace_country ?? "")
      .trim()
      .toUpperCase();
    const marketplaceId = resolveAmazonMarketplaceId(
      marketplaceCode,
      marketplaceIdByCode,
    );

    if (!marketplaceId) {
      warningSet.add(
        `No se pudo resolver marketplace para code ${marketplaceCode}`,
      );
      continue;
    }

    const tipoCliente = row.is_business_order ? "B2B" : "B2C";
    const pais = marketplaceCode || "UNKNOWN";
    const moneda = row.currency || "EUR";
    const canalVenta = mapCanalVentaToVentasDiarias(row.canal_venta);

    const key = [
      row.producto_id,
      row.purchase_date,
      pais,
      canalVenta,
      moneda,
      tipoCliente,
      marketplaceId,
    ].join("||");

    const prev = grouped.get(key);
    if (prev) {
      prev.unidades_vendidas += row.quantity;
      prev.ingresos_brutos += row.gross;
      prev.iva_pagado_cuota += row.tax;
      prev.ingresos_netos_sin_iva =
        prev.ingresos_brutos - prev.iva_pagado_cuota;
      continue;
    }

    grouped.set(key, {
      producto_id: row.producto_id,
      fecha: row.purchase_date,
      pais,
      canal_venta: canalVenta,
      moneda,
      tipo_cliente: tipoCliente,
      marketplace_id: marketplaceId,
      unidades_vendidas: row.quantity,
      ingresos_brutos: row.gross,
      iva_pagado_cuota: row.tax,
      publicidad_gasto_ads: 0,
      comisiones_amazon_referral: 0,
      comisiones_amazon_fba: 0,
      coste_devoluciones: 0,
      ingresos_netos_sin_iva: row.gross - row.tax,
      source,
    });
  }

  return {
    rows: Array.from(grouped.values()),
    warnings: Array.from(warningSet),
  };
}

async function loadAmazonMarketplaceIdByCode(): Promise<Map<string, string>> {
  const { data: marketplaces, error } = await supabaseAdmin
    .from("amazon_marketplaces")
    .select("id, code, name, currency, region, language_code");

  if (error) {
    throw new Error(`Error cargando amazon_marketplaces: ${error.message}`);
  }

  return new Map(
    (marketplaces ?? []).map((m) => [
      String((m as { code?: string }).code ?? "")
        .trim()
        .toUpperCase(),
      String((m as { id?: string }).id ?? "").trim(),
    ]),
  );
}

export async function syncVentasDiariasFromStaging(params: {
  productoIds: string[];
  dateFrom: string;
  dateTo: string;
  source?: string;
}): Promise<{ upserted: number; warnings: string[] }> {
  if (params.productoIds.length === 0) {
    return { upserted: 0, warnings: [] };
  }

  const source = params.source?.trim() || "amazon_all_orders";
  const marketplaceIdByCode = await loadAmazonMarketplaceIdByCode();
  const uniqueProductoIds = Array.from(new Set(params.productoIds));
  const stagingRows: StagingAggregateRow[] = [];

  for (let i = 0; i < uniqueProductoIds.length; i += 200) {
    const chunk = uniqueProductoIds.slice(i, i + 200);
    const { data, error } = await supabaseAdmin
      .from("amazon_all_orders_items")
      .select(
        "producto_id, purchase_date, marketplace_country, canal_venta, currency, sales_channel, is_business_order, quantity, item_price, shipping_price, gift_wrap_price, item_promotion_discount, ship_promotion_discount, item_tax, shipping_tax, gift_wrap_tax, order_status, item_status",
      )
      .in("producto_id", chunk)
      .gte("purchase_date", params.dateFrom)
      .lte("purchase_date", params.dateTo)
      .not("producto_id", "is", null);

    if (error) throw new Error(error.message);

    for (const raw of data ?? []) {
      const row = raw as {
        producto_id: string;
        purchase_date: string;
        marketplace_country: string;
        canal_venta: string;
        currency: string;
        sales_channel: string;
        is_business_order: boolean;
        quantity: number;
        item_price: number;
        shipping_price: number;
        gift_wrap_price: number;
        item_promotion_discount: number;
        ship_promotion_discount: number;
        item_tax: number;
        shipping_tax: number;
        gift_wrap_tax: number;
        order_status: string;
        item_status: string;
      };

      if (
        !isStagingRowEligibleForVentas({
          orderStatus: row.order_status ?? "",
          itemStatus: row.item_status ?? "",
          quantity: Number(row.quantity ?? 0),
        })
      ) {
        continue;
      }

      const gross =
        Number(row.item_price ?? 0) +
        Number(row.shipping_price ?? 0) +
        Number(row.gift_wrap_price ?? 0) -
        Number(row.item_promotion_discount ?? 0) -
        Number(row.ship_promotion_discount ?? 0);
      const tax =
        Number(row.item_tax ?? 0) +
        Number(row.shipping_tax ?? 0) +
        Number(row.gift_wrap_tax ?? 0);

      stagingRows.push({
        producto_id: row.producto_id,
        purchase_date: row.purchase_date,
        marketplace_country: row.marketplace_country || "UNKNOWN",
        canal_venta: row.canal_venta || "AMAZON",
        currency: row.currency || "EUR",
        sales_channel: row.sales_channel || "",
        is_business_order: Boolean(row.is_business_order),
        quantity: Number(row.quantity ?? 0),
        gross,
        tax,
      });
    }
  }

  const { rows: ventasRows, warnings } = aggregateStagingRows(
    stagingRows,
    marketplaceIdByCode,
    source,
  );
  if (ventasRows.length === 0) {
    return { upserted: 0, warnings };
  }

  let affected = 0;
  for (let i = 0; i < ventasRows.length; i += UPSERT_BATCH_SIZE) {
    const batch = ventasRows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabaseAdmin.from("ventas_diarias").upsert(batch, {
      onConflict:
        "producto_id,fecha,pais,canal_venta,moneda,tipo_cliente,marketplace_id",
    });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return { upserted: affected, warnings };
}
