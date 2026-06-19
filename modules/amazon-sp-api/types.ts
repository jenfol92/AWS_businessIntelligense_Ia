export type LwaTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type SpApiReport = {
  reportId: string;
  reportType: string;
  processingStatus: string;
  reportDocumentId?: string;
  createdTime?: string;
  processingStartTime?: string;
  processingEndTime?: string;
  marketplaceIds?: string[];
};

export type SpApiReportDocument = {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: "GZIP" | string;
};

export type SpApiReportJobStatus =
  | "CREATED"
  | "SUBMITTED"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELLED"
  | "FATAL"
  | "DOWNLOADED"
  | "PARSED_PREVIEW"
  | "IMPORTED"
  | "ERROR";

export type AmazonSpApiReportJobRow = {
  id: string;
  report_type: string;
  report_id: string | null;
  report_document_id: string | null;
  status: SpApiReportJobStatus;
  processing_status: string | null;
  marketplace_ids: string[] | null;
  requested_at: string;
  completed_at: string | null;
  downloaded_at: string | null;
  source: string;
  error_message: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type CreateReportInput = {
  reportType: string;
  marketplaceIds: string[];
  reportOptions?: Record<string, string>;
};

export type CreateReportResult = {
  reportId: string;
};
