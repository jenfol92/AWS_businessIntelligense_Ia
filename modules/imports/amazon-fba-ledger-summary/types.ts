export type AmazonFbaLedgerImportMode = "preview" | "commit";

export type AmazonFbaLedgerSource =
  | "amazon_fba_ledger_summary_manual"
  | (string & {});

export type ParsedAmazonFbaLedgerRow = {
  rowNumber: number;
  snapshotDate: string;
  skuOriginal: string;
  mskuAliases: string[];
  skuLimpio: string;
  fnsku: string | null;
  asin: string;
  conditionType: string | null;
  title: string | null;
  disposition: string;
  startingWarehouseBalance: number;
  inTransitBetweenWarehouses: number;
  receipts: number;
  customerShipments: number;
  customerReturns: number;
  vendorReturns: number;
  warehouseTransferInOut: number;
  found: number;
  lost: number;
  damaged: number;
  disposed: number;
  otherEvents: number;
  endingWarehouseBalance: number;
  unknownEvents: number;
  location: string;
  raw: Record<string, unknown>;
};

export type AmazonFbaLedgerParseWarning = {
  row: number;
  message: string;
};

export type AmazonFbaLedgerParseResult = {
  totalRows: number;
  twinlyRows: number;
  skippedNonTwinlyRows: number;
  validRows: ParsedAmazonFbaLedgerRow[];
  skippedRows: number;
  warnings: AmazonFbaLedgerParseWarning[];
};

export type AmazonFbaLedgerPreviewSampleRow = {
  snapshotDate: string;
  skuOriginal: string;
  mskuAliases: string[];
  skuLimpio: string;
  fnsku: string | null;
  asin: string | null;
  conditionType: string | null;
  title: string | null;
  disposition: string | null;
  endingWarehouseBalance: number;
  receipts: number;
  customerShipments: number;
  location: string | null;
};

export type AmazonFbaLedgerRowsByMonth = {
  month: string;
  rows: number;
  uniqueSkus: number;
};

export type AmazonFbaLedgerUnlinkedSku = {
  skuLimpio: string;
  rows: number;
};

export type AmazonFbaLedgerPreviewResponse = {
  ok: true;
  mode: "preview";
  totalRows: number;
  twinlyRows: number;
  skippedNonTwinlyRows: number;
  validRows: number;
  skippedRows: number;
  uniqueSkus: number;
  unlinkedProductRows: number;
  conflictRows: number;
  unknownConditionRows: number;
  unlinkedSkus: AmazonFbaLedgerUnlinkedSku[];
  skipUnlinkedProducts: boolean;
  importableRows: number;
  omittedUnlinkedRows: number;
  dateRange: {
    from: string | null;
    to: string | null;
  };
  rowsByMonth: AmazonFbaLedgerRowsByMonth[];
  dispositions: string[];
  locations: string[];
  warnings: AmazonFbaLedgerParseWarning[];
  sampleRows: AmazonFbaLedgerPreviewSampleRow[];
};

export type AmazonFbaLedgerCommitResponse = {
  ok: true;
  mode: "commit";
  totalRows: number;
  twinlyRows: number;
  skippedNonTwinlyRows: number;
  validRows: number;
  skippedRows: number;
  uniqueSkus: number;
  unlinkedProductRows: number;
  conflictRows: number;
  unknownConditionRows: number;
  skipUnlinkedProducts: boolean;
  insertedOrUpdated: number;
  omittedUnlinkedRows: number;
  source: string;
  sourceFileName: string | null;
  reportDocumentId: string | null;
  warnings: AmazonFbaLedgerParseWarning[];
};

export type AmazonFbaLedgerDbRow = {
  producto_id: string | null;
  sku_original: string;
  msku_aliases: string[];
  sku_limpio: string;
  fnsku: string;
  asin: string;
  condition_type: string;
  title: string | null;
  snapshot_date: string;
  disposition: string;
  starting_warehouse_balance: number;
  in_transit_between_warehouses: number;
  receipts: number;
  customer_shipments: number;
  customer_returns: number;
  vendor_returns: number;
  warehouse_transfer_in_out: number;
  found: number;
  lost: number;
  damaged: number;
  disposed: number;
  other_events: number;
  ending_warehouse_balance: number;
  unknown_events: number;
  location: string;
  location_raw: string;
  location_type: "COUNTRY" | "FC" | "OTHER" | "UNKNOWN";
  physical_country: string | null;
  location_evidence_source: string | null;
  location_evidence_confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  location_country: string | null;
  source: string;
  source_file_name: string | null;
  report_document_id: string | null;
  manual_document_hash: string | null;
  document_identity_type: "REPORT_DOCUMENT_ID" | "MANUAL_SHA256";
  document_identity: string;
  raw: Record<string, unknown>;
  updated_at: string;
};
