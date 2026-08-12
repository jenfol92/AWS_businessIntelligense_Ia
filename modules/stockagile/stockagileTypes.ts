export const STOCKAGILE_FBM_SOURCE = "stockagile_fbm_sales";

export type StockagileOrderLineInput = {
  externalOrderId: string;
  externalOrderLineId?: string | null;
  orderDate: string;
  orderDatetime?: string | null;
  salesChannel?: string | null;
  marketplace?: string | null;
  fulfillmentType?: string | null;
  country?: string | null;
  currency?: string | null;
  orderStatus?: string | null;
  skuOriginal?: string | null;
  quantity?: number | null;
  grossAmount?: number | null;
  unitPrice?: number | null;
  raw?: Record<string, unknown>;
};

export type StockagileRawDbRow = {
  import_batch_id: string;
  source: string;
  dedupe_key: string;
  external_order_id: string;
  external_order_line_id: string | null;
  order_date: string;
  order_datetime: string | null;
  sales_channel: string | null;
  marketplace: string | null;
  fulfillment_type: string | null;
  country: string;
  currency: string;
  order_status: string | null;
  sku_original: string | null;
  sku_limpio: string | null;
  ean_twinly: string | null;
  is_twinly: boolean;
  omit_reason: "NON_TWINLY" | "PRODUCT_NOT_FOUND" | null;
  quantity: number;
  gross_amount: number;
  unit_price: number | null;
  producto_id: string | null;
  raw: Record<string, unknown>;
  updated_at: string;
};

export type StockagileSyncSummary = {
  deletedPreviousRows: number;
  insertedRows: number;
  insertedUnits: number;
  nonTwinlyRows: number;
  nonTwinlyUnits: number;
  orphanTwinlyRows: number;
  orphanTwinlyUnits: number;
  skippedCancelledRows: number;
  skippedFbaRows: number;
};

export type StockagileImportSummary = {
  importBatchId: string;
  rawRowsUpserted: number;
  parsedLines: number;
  twinlyLines: number;
  nonTwinlyLines: number;
  productNotFoundLines: number;
};
