export type AmazonAllOrdersImportMode = "preview" | "commit";

export type AmazonAllOrdersSource = "amazon_all_orders_manual" | (string & {});

export type ParsedAmazonAllOrdersRow = {
  rowNumber: number;
  amazonOrderId: string;
  merchantOrderId: string;
  orderItemId: string;
  purchaseDatetime: string;
  purchaseDate: string;
  lastUpdatedDatetime: string | null;
  orderStatus: string;
  itemStatus: string;
  fulfillmentChannel: string;
  salesChannel: string;
  marketplaceCountry: string;
  shipCountry: string;
  skuOriginal: string;
  skuLimpio: string;
  asin: string;
  productName: string | null;
  quantity: number;
  currency: string;
  itemPrice: number;
  itemTax: number;
  shippingPrice: number;
  shippingTax: number;
  giftWrapPrice: number;
  giftWrapTax: number;
  itemPromotionDiscount: number;
  shipPromotionDiscount: number;
  isBusinessOrder: boolean;
  canalVenta: string;
  tipoCliente: "B2B" | "B2C";
  gross: number;
  tax: number;
  rowFingerprint: string;
  raw: Record<string, unknown>;
};

export type AmazonAllOrdersParseWarning = {
  row: number;
  message: string;
};

export type AmazonAllOrdersParseResult = {
  totalRows: number;
  twinlyRows: number;
  skippedNonTwinlyRows: number;
  skippedCancelledRows: number;
  skippedQuantityZeroRows: number;
  skippedRows: number;
  validRows: ParsedAmazonAllOrdersRow[];
  warnings: AmazonAllOrdersParseWarning[];
};

export type AmazonAllOrdersPreviewSampleRow = {
  purchaseDate: string;
  skuOriginal: string;
  skuLimpio: string;
  asin: string | null;
  productLinked: boolean;
  orderStatus: string | null;
  itemStatus: string | null;
  quantity: number;
  itemPrice: number;
  itemTax: number;
  salesChannel: string | null;
  marketplaceCountry: string;
  shipCountry: string | null;
  canalVenta: string;
};

export type AmazonAllOrdersRowsByMonth = {
  month: string;
  rows: number;
  uniqueSkus: number;
};

export type AmazonAllOrdersRowsByKey = {
  key: string;
  rows: number;
};

export type AmazonAllOrdersUnlinkedSku = {
  skuLimpio: string;
  rows: number;
};

export type AmazonAllOrdersPreviewResponse = {
  ok: true;
  mode: "preview";
  totalRows: number;
  twinlyRows: number;
  validRows: number;
  importableRows: number;
  skippedNonTwinlyRows: number;
  skippedCancelledRows: number;
  skippedQuantityZeroRows: number;
  skippedUnlinkedRows: number;
  omittedUnlinkedRows: number;
  uniqueSkus: number;
  skipUnlinkedProducts: boolean;
  dateRange: { from: string | null; to: string | null };
  rowsByMonth: AmazonAllOrdersRowsByMonth[];
  rowsByMarketplace: AmazonAllOrdersRowsByKey[];
  rowsByChannel: AmazonAllOrdersRowsByKey[];
  unlinkedSkus: AmazonAllOrdersUnlinkedSku[];
  warnings: AmazonAllOrdersParseWarning[];
  sampleRows: AmazonAllOrdersPreviewSampleRow[];
};

export type AmazonAllOrdersCommitResponse = {
  ok: true;
  mode: "commit";
  totalRows: number;
  twinlyRows: number;
  validRows: number;
  importableRows: number;
  skippedNonTwinlyRows: number;
  skippedCancelledRows: number;
  skippedQuantityZeroRows: number;
  skippedUnlinkedRows: number;
  omittedUnlinkedRows: number;
  /** Alias de skippedUnlinkedRows para UI. */
  notFoundRows: number;
  uniqueSkus: number;
  skipUnlinkedProducts: boolean;
  stagingInsertedOrUpdated: number;
  ventasDiariasUpserted: number;
  dateRange: { from: string | null; to: string | null };
  rowsByMarketplace: AmazonAllOrdersRowsByKey[];
  unlinkedSkus: AmazonAllOrdersUnlinkedSku[];
  source: string;
  sourceFileName: string | null;
  warnings: AmazonAllOrdersParseWarning[];
};

export type AmazonAllOrdersDbRow = {
  producto_id: string | null;
  amazon_order_id: string;
  merchant_order_id: string;
  order_item_id: string;
  purchase_datetime: string;
  purchase_date: string;
  last_updated_datetime: string | null;
  order_status: string;
  item_status: string;
  fulfillment_channel: string;
  sales_channel: string;
  marketplace_country: string;
  ship_country: string;
  sku_original: string;
  sku_limpio: string;
  asin: string;
  product_name: string | null;
  quantity: number;
  currency: string;
  item_price: number;
  item_tax: number;
  shipping_price: number;
  shipping_tax: number;
  gift_wrap_price: number;
  gift_wrap_tax: number;
  item_promotion_discount: number;
  ship_promotion_discount: number;
  is_business_order: boolean;
  canal_venta: string;
  row_fingerprint: string;
  source: string;
  source_file_name: string | null;
  raw: Record<string, unknown>;
  updated_at: string;
};

export type VentasDiariasUpsertRow = {
  producto_id: string;
  fecha: string;
  pais: string;
  canal_venta: string;
  moneda: string;
  tipo_cliente: string;
  marketplace_id: string;
  unidades_vendidas: number;
  ingresos_brutos: number;
  iva_pagado_cuota: number;
  publicidad_gasto_ads: number;
  comisiones_amazon_referral: number;
  comisiones_amazon_fba: number;
  coste_devoluciones: number;
  ingresos_netos_sin_iva: number | null;
  source: string;
};
