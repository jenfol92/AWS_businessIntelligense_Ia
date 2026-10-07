import { retryAt, type SalesSyncState, type SalesChunk } from "./fbaSalesSyncPolicy.ts";

export interface SalesWorkerDependencies {
  now(): number;
  save(state: SalesSyncState): Promise<void>;
  create(chunk: SalesChunk): Promise<string>;
  poll(reportId: string): Promise<{ processingStatus: string; reportDocumentId?: string; reportType?: string; dataStartTime?: string; dataEndTime?: string }>;
  publish(chunk: SalesChunk, completed: SalesSyncState): Promise<void>;
  errorInfo(error: unknown): { rateLimited: boolean; retryAfter?: string | null; message: string };
}
export const FBA_SALES_REPORT_TYPE = "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL";
/** One bounded step. No sleeps; remote work never holds a database transaction. */
export async function advanceFbaSalesSync(input: SalesSyncState, deps: SalesWorkerDependencies): Promise<SalesSyncState> {
  const state = structuredClone(input);
  if (["COMPLETED", "FAILED", "FATAL"].includes(state.status) ||
      (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > deps.now())) return state;
  const chunk = state.chunks[state.chunkIndex];
  if (!chunk) throw new Error("INVALID_SALES_CHUNK");
  state.error = null;
  state.nextAttemptAt = null;
  if (chunk.phase === "CREATE_INTENT") {
    state.status = "FAILED";
    state.error = "CREATE_OUTCOME_UNKNOWN: reconcile the existing Amazon report before recovery; automatic recreation disabled.";
    await deps.save(state);
    return state;
  }
  if (chunk.attempts >= 48) {
    state.status = "FAILED"; state.error = "ATTEMPT_LIMIT_REACHED";
    await deps.save(state); return state;
  }
  chunk.attempts += 1;
  state.status = "PROCESSING";
  if (chunk.phase !== "CREATE") await deps.save(state);
  try {
    if (state.mode === "import" && chunk.phase === "CREATE") {
      chunk.phase = "CREATE_INTENT";
      await deps.save(state); // Durable intent before a non-idempotent remote create.
      chunk.reportId = await deps.create(chunk);
      if (!chunk.reportId) throw new Error("MISSING_REPORT_ID");
      chunk.phase = "POLL";
      state.status = "PENDING";
      state.nextAttemptAt = retryAt("60", 0, deps.now());
    } else if (state.mode === "import" && chunk.phase === "POLL") {
      const report = await deps.poll(chunk.reportId!);
      chunk.processingStatus = report.processingStatus;
      chunk.documentId = report.reportDocumentId;
      chunk.diagnostic = { processingStatus:report.processingStatus, reportDocumentId:report.reportDocumentId ?? null,
        reportType:report.reportType ?? null, dataStartTime:report.dataStartTime ?? null, dataEndTime:report.dataEndTime ?? null };
      if (report.reportType !== FBA_SALES_REPORT_TYPE) throw new Error("REPORT_TYPE_MISMATCH");
      if (!report.dataStartTime || !report.dataEndTime ||
          Date.parse(report.dataStartTime) !== Date.parse(`${chunk.fromDate}T00:00:00Z`) ||
          Date.parse(report.dataEndTime) !== Date.parse(`${chunk.toDate}T23:59:59Z`)) throw new Error("REPORT_RANGE_MISMATCH");
      if (report.processingStatus === "FATAL" || report.processingStatus === "CANCELLED") {
        state.status = report.processingStatus === "FATAL" ? "FATAL" : "FAILED";
        state.error = `AMAZON_REPORT_${report.processingStatus}`;
      } else if (report.processingStatus === "DONE") {
        if (!chunk.documentId) throw new Error("MISSING_REPORT_DOCUMENT_ID");
        chunk.phase = "DOWNLOAD";
      } else if (["IN_QUEUE", "IN_PROGRESS", "PROCESSING"].includes(report.processingStatus)) {
        state.status = report.processingStatus === "IN_QUEUE" ? "PENDING" : "PROCESSING";
        state.nextAttemptAt = retryAt("60", 0, deps.now());
      } else throw new Error("INVALID_AMAZON_PROCESSING_STATUS");
    } else {
      // Publication also persists this checkpoint atomically; no success before commit.
      const completed = structuredClone(state);
      const committedAt = new Date(deps.now()).toISOString();
      completed.chunks[state.chunkIndex].phase = "COMPLETED";
      completed.chunks[state.chunkIndex].committedAt = committedAt;
      completed.lastCommittedAt = committedAt;
      completed.chunkIndex += 1;
      completed.status = completed.chunkIndex === completed.chunks.length ? "COMPLETED" : "PENDING";
      await deps.publish(chunk, completed);
      return completed;
    }
  } catch (error) {
    const info = deps.errorInfo(error);
    state.error = info.message;
    state.status = info.rateLimited ? "RATE_LIMITED" : "FAILED";
    if (info.rateLimited) {
      if (chunk.phase === "CREATE_INTENT") chunk.phase = "CREATE"; // explicit 429 rejected creation
      state.nextAttemptAt = retryAt(info.retryAfter, chunk.attempts, deps.now());
    }
  }
  await deps.save(state);
  return state;
}
